# run_code（PTC）开销压测报告

日期：2026-11-04 ｜ 环境：WSL2 / dsh web 3081 / profile `web` / model `deepseek-v4.1-flash`（wb-proxy）

## 1. 被测的三个优化

| 代号 | 改动 | 生效方式 |
|---|---|---|
| B | PTC 运行时改 `persistent-in-memory`（每个会话一个常驻 node 进程） | `cordis.patch.yml` 的 `dsh-tools` 配置 |
| A | `glob` / `grep` 声明 `isConcurrencySafe` | 改 profile 内 vendored 的 `dsh-tool-fs-search` |
| — | 工具结果裁剪落盘（pruner spill） | 可选补丁，**默认关闭**，本报告不涉及 |

## 2. 核心数据：嵌套调用随规模线性

在**一个** program 里串行发起 N 次 `bash echo`，每次单独计时：

| N | 总耗时 | 单次中位 | p95 | 最小 / 最大 |
|---|---|---|---|---|
| 1 | 15 ms | 15 ms | 15 ms | 15 / 15 |
| 5 | 73 ms | 14 ms | 15 ms | 14 / 15 |
| 20 | 300 ms | 15 ms | 17 ms | 13 / 18 |
| 50 | 760 ms | 15 ms | 18 ms | 13 / 22 |

**结论**：单次 15 ms，到 50 次仍严格线性（15.2 ms/次），无排队放大、无内存劣化。

## 3. 嵌套 Promise.all 不等于并行

同一 program 内 `Promise.all` 发 10 个 `bash`：**138 ms**（13.8 ms/个）。

串行 10 次预期 150 ms → 嵌套并发**几乎等于串行**。原因：PTC 通道对嵌套调用是单队列，`isConcurrencySafe` 只在**模型一轮内发多个原生 tool-call** 时才有意义。

## 4. 被 B 消掉的固定成本

| 测量项 | 中位 |
|---|---|
| `node -e 0`（裸启动） | 52 ms |
| node 启动 + 加载 PTC 运行时模块 | **62 ms** |
| 改造前实测「每个 program 首行 `process.uptime()`」 | **108 ms** |

`108 ms` 才是真实固定成本（含 DSH 侧引导），`per-call` 模式下每个 program 都付一次。

## 5. 收益模型与实测对照

一个 program 里有 K 次嵌套调用：

- 改造前：`108 + 44K` ms（44 ms 是 per-call 模式下实测的单次通道开销）
- 改造后：`15K` ms
- 净收益：`108 + 29K` ms

| K | 改造前 | 改造后 | 净省 | 倍数 |
|---|---|---|---|---|
| 1 | 152 ms | 15 ms | 137 ms | 9.1× |
| 5 | 328 ms | 73 ms | 255 ms | 4.5× |
| 20 | 988 ms | 300 ms | 688 ms | 3.3× |
| 50 | 2 308 ms | 760 ms | 1 548 ms | 3.0× |

**怎么读**：倍数随 K 增大而收敛到 2.9×（44/15），固定成本那 108 ms 只在 K 小时显得巨大。

## 6. 原生多调用并发（A）的对照

同一轮内让模型发 3 个 `glob`（headless 探针，事件时间戳）：

| 配置 | 工具段耗时 | 事件顺序 |
|---|---|---|
| 未打 A 补丁 | 492 ms | `call → result → call → result → call → result` |
| 打了 A 补丁 | **204 ms** | `call × 3 → result × 3` |

**2.4×**，且可复现。注意：这条只在“模型愿意一轮发多个调用”时兑现，而折叠成 PTC 的用法拿不到它。

## 7. 代价与边界

| 项 | 实测 / 事实 | 影响 |
|---|---|---|
| 变量跨 program 保留 | REPL 语义；今天踩到 2 次重名 `const` 报错 | 每次约 1 个 step |
| 单 state owner | `persistent PTC does not accept concurrent runs` | 日常不触发（`run_code` 未声明并发，调度器串行） |
| 堆上限 | 默认 512 MB，restart/disposal 清理保留状态 | 长会话可能撞限 → 该会话运行时重建，失败一次 |
| 异常 | 故意抛错后同 pid 继续可用（uptime 75.9 s 验证） | 无需重启会话 |

## 8. 复现方法

在一个 `run_code` program 里（IIFE 包裹，避免重名）：

```js
await (async () => {
  for (const n of [1, 5, 20, 50]) {
    const per = [];
    for (let i = 0; i < n; i++) {
      const s = Date.now();
      await tools.bash({ description: "k" + i, command: "echo " + i });
      per.push(Date.now() - s);
    }
    console.log(n, per.sort((a, b) => a - b));
  }
})();
```

固定成本用 bash 侧对照：`node --max-old-space-size=512 -e "import('…/dsh-ptc-runtime-node/lib/index.js').then(() => process.exit(0))"`。

## 9. 一句话结论

B 把「每个 program 的固定成本」清零、把嵌套调用从 44 ms 压到 15 ms，收益随 program 内调用密度线性增长（K=50 时省 1.5 s）；A 在原生多调用场景给 2.4×。**两者对“单条命令的短任务”几乎无感，对“折叠几十次调用的大活”才是主要收益。**

## 10. 落地方式（2026-11-04 起：随插件生效）

原先两项优化只写在 `~/.dsh/profiles/web/cordis.patch.yml`（profile 级，换预设不受影响，但重装 profile 会丢）。现已并入 `dsh-plan-mode-ui` 的补丁层与安装流程：

| 项 | 落点 | 生效时机 |
|---|---|---|
| B 常驻运行时 | 主包 `cordis.patch.yml`（`compose-bundle-patch.mjs` 合成；插件补丁层也有同一段） | 装包 → 重启 dsh |
| A 只读并发 | `scripts/tune-runtime.mjs --apply`（改 profile 内 vendored 的 `dsh-tool-fs-search`，先备份） | 同上，安装脚本自动调用 |

自检（任一时刻一条命令）：

```bash
node scripts/tune-runtime.mjs                 # 只报告
node scripts/tune-runtime.mjs --apply         # 缺什么补什么（幂等）
```

输出示例：

```
profile     B 常驻运行时         A 只读并发        isConcurrencySafe
web         ok              ok            2
```

**边界**：B 是配置项，运行时无法从别的插件热改（`executionMode` 在构造函数里读，`inMemory` 随之创建）；A 是文件级补丁，重装 `dsh-tool-fs-search` 会被覆盖——两者都由上面这条命令兜住。
