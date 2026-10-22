# 基准与规则消融（bench）

本仓库的效能主张（token 消耗、墙钟、判分）需要**可复现、可持续**的评测管线来背书。
`docs/实测证据.md` 记录的是 2026-10 的洛谷快照（每组 n=2-3）；`bench/` 提供的是此后可
每周自动重跑的本地题库、判题器、计费解析与回归门。

## 为什么不用洛谷

洛谷判题依赖外部服务与题目版权，无法在 CI 里离线复现。seed 题自包含（题面 + 数据 +
判题器），跨平台、零依赖，任何有 DEEPSEEK_API_KEY 的机器都能跑出可比的数字。洛谷
实测仍可人工追加到 `docs/实测证据.md`，但回归门只看 `bench/results/`。

## 题目协议

一个题目 = 一个目录，含：

| 文件 | 作用 |
|---|---|
| `statement.md` | 题面（含**写死的交付标准**：交付文件、可复跑脚本、verify.log——这是实测里最有效的杠杆） |
| `limits.json` | 时限 / 满分 / 交付文件名 / 复跑命令 |
| `judge.mjs` | `node judge.mjs <workspaceDir>`，输出单行 JSON `{score,maxScore,verdict,timeMs,detail}`，exit 0=AC |
| 数据文件 | 如 `input.json`、`data/`（runner 会复制进 workspace） |

判题器双向覆盖：缺失交付物 → WA；交付正确 → AC（本地已验证两种路径）。

## runner

```bash
node bench/run.mjs --list                                            # 列题
node bench/run.mjs --dry-run --problem p-prime-gap                   # 只打印计划
node bench/run.mjs --problem p-prime-gap --arm baseline              # 单题一臂
node bench/run.mjs --batch --preset flash-lean-ptc-v3 --arm baseline # 全部 seed 题
node bench/run.mjs --batch --strip-rules 1,4 --arm no-rule1-4        # 消融：删掉规则 1、4
```

流程：临时 `DSH_HOME` + 临时 workspace → 把预设行（可消融）与默认预设写入 headless
profile 补丁 → `dsh headless --json "<题面>"` → 解析 ndjson 里 `step_end` 的 usage
（**计费口径 = inputTokens + cacheReadTokens**，与 `docs/实测证据.md` 一致）与
`turn_end` 数 → judge 判分 → 追加一行 CSV 到 `bench/results/runs.csv`。

CSV 列：`timestamp,dsh_version,problem,preset,arm,rules_kept,score,max_score,verdict,
time_ms,billed_input,billed_cache,wall_ms,turns,final_len,error,log`。

### 消融协议（规则是否真的有用）

`--strip-rules N,M` 从 persona suffix 里删除对应编号的规则段再跑同一题。对照设计：

1. 先跑一臂 `--arm baseline`（13 条规则全留），结果复制为 `bench/results/baseline.csv`；
2. 对每条规则（或规则组）跑 `--arm minus-N`；
3. `bench/gate.mjs` 只对非 `minus-` 臂做回归判定；消融臂人工读表：删掉某条规则后
   分数不降、计费不升 → 该规则不显著，可考虑从预设里拿掉（省常驻 prompt 开销）。

样本量纪律：每组 ≥ 5 次再下结论（seed 题便宜，批跑即可）。

## 回归门

```bash
node bench/gate.mjs                                   # runs.csv vs baseline.csv
node bench/gate.mjs --max-cost-rise 0.2 --max-wall-rise 0.5
```

按 `problem × preset × arm` 分组取中位数：score 不降、计费增幅 ≤ 15%、墙钟增幅 ≤ 30%，
任一越限 exit 1。无 baseline 时 exit 0 并提示先建立 baseline。

## CI

`.github/workflows/bench.yml` 每周日 UTC 01:00 自动跑，也可 `workflow_dispatch` 手动
触发（可传 problems / preset / arm / strip_rules / dsh）。仓库没有配
`DEEPSEEK_API_KEY` secret 时只跑 smoke（清单 / 干跑 / 判题器自检）保持绿色；配了
secret 就跑真实评测 + 回归门 + 上传结果 artifact。

## 已知局限

- headless 单题一轮（不重跑同题做方差）；低成本题可本地 `--batch` 多次取中位数。
- headless bundle「不构成 preset roster」：runner 把预设的 model-facing 行**平铺到宿主层**
  模拟选中预设，与真实 preset realm 有两处语义差异——`cordis:group` 的 isolate realm
  不生效；`tool-subagent` 的 `modelSelectionSettings` 在 headless 宿主缺服务时会报错
  （不影响 seed 题，但子代理类任务的读数不可比）。
- 判题器计时是墙钟（Node 内计时），内存约束目前只在 `limits.json` 里声明、
  未强制（Linux CI 可用 `/usr/bin/time -v` 补强，欢迎 PR）。
- 计费不含输出 token（`docs/实测证据.md` 口径即输入 + 缓存读），保持口径可比。
- 结论按 arm 读中位数、n ≥ 5 再下判断；单个题目、单次运行的绝对数字不作数。
