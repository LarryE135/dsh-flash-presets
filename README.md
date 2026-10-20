<p align="center"><strong>dsh-flash-presets</strong></p>

<p align="center"><strong>中文</strong> | <a href="#english-summary">English</a></p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-flash-presets"><img alt="npm" src="https://img.shields.io/npm/v/dsh-flash-presets?style=flat-square&color=6c5ce7"></a>
  <a href="https://www.npmjs.com/package/dsh-flash-presets"><img alt="npm downloads" src="https://img.shields.io/npm/dm/dsh-flash-presets?style=flat-square&color=4b6fff"></a>
  <a href="https://github.com/LarryE135/dsh-flash-presets/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/LarryE135/dsh-flash-presets?style=flat-square&color=eab308"></a>
</p>

# dsh-flash-presets

面向 flash 级路由的 DSH agent 预设。以 **DSH 组合包**（`dsh.bundle`）形式交付：往 profile 的插件列表插入若干行 `@deepseek-ai/dsh-agent-preset`，不改宿主、不加运行时代码、不碰共享工具注册表。

预设做三件事：约束**预算与轮数**（按轮不按步）、按需折叠工具输出、把验收标准写进流程。目标是让便宜的路由在**长任务上不失手**，而不是让它"更聪明"。

> [!IMPORTANT]
> 本分支是 **0.2.1**，`v3`（内部代号 **lean-v3**）为现行主版本，对齐 DSH **0.2.1-rc.2**。
> 已验证：三平台安装器回归、模拟安装（`DSH_HOME` 指向临时目录 → 安装 → `dsh 0.2.1 --dump-config` 合成出三个预设 → 重复安装幂等 → 卸载干净）、组合包合成一致性（`--check`）。
> 未验证：未在 macOS 真机跑过；PTC 之外的模式（native）没有同规模对照。
> 证据与失效场景见[实测证据](docs/实测证据.md)与[已知限制](#已知限制)。

- 三个预设：`flash-lean-ptc-v1`（基线）、`v2`（上一代）、`v3`（现行主版本）；均为 patch-only 组合包，可共存、逐项选择。
- `v3` 相对 `v2`：保留轮数预算与按需折叠，新增**反过度自测**——验收门一旦通过就交付，不再追加随机/压测轮。针对实测"失败模式从答错迁移到 TLE / 拖时长"。
- 压缩：`thresholdRatio 0.25` + `retainTokens 20000`（v1 为 0.3 / 50000）；工具结果裁剪 8192 / 4096 / 1024 不变。
- 展示层固定 `tool-presentation: mode: ptc`；`tool-workflow` 停用。
- 无 `main`、无 `prepare`、无 `postinstall`：包内只有 YAML，安装不会触发 pnpm 的 `allowBuilds` 拦截。

## 安装、更新、卸载

### 组合包一键安装

```console
dsh plugin --profile web add github:LarryE135/dsh-flash-presets
```

`--profile` 换成目标 profile：`web` / `desktop` / `headless` / `acp`。管理器把本包写进该 profile 的 `dsh.profile.bundles`，并按 `cordis.patch.yml` 依次叠加 v1 / v2 / v3。`web` 是 live reload（刷新 GUI 即出现），其它 profile 需重启。

更新：重复执行同一条 `add`（或先 `remove` 再 `add`）。卸载：把本包从 `dsh.profile.bundles` 与依赖中移除后重装依赖；旧式手工托管块用 `scripts/install.sh --uninstall` 清理。

### 手动安装（脚本）

```bash
git clone https://github.com/LarryE135/dsh-flash-presets.git
cd dsh-flash-presets
```

**Linux / macOS / WSL / Git Bash**

```bash
bash scripts/install.sh                         # 0.1.7+ 写 profile 补丁；更旧的 DSH 回退目录式
bash scripts/install.sh --profile desktop       # 指定 profile（默认 web）
bash scripts/install.sh --uninstall             # 卸载（移除托管块）
DSH_HOME=/path/to/.dsh bash scripts/install.sh  # 自定义 DSH 主目录
```

**Windows（PowerShell 5.1+ / 7）**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install.ps1
.\scripts\install.ps1 -Profile desktop
.\scripts\install.ps1 -Uninstall
.\scripts\install.ps1 -DshHome D:\tmp\.dsh
```

两个安装器共用 `scripts/merge-presets.mjs`：先备份 `cordis.patch.yml.bak-<时间戳>`，再整块替换托管块，可重复执行。

### 校验

```console
node scripts/verify-presets.mjs                  # 结构与取值断言（可配 DSH_HOME / DSH_PROFILE 指向模拟安装）
node scripts/verify-yaml.mjs                     # YAML 与跨平台标签检查
node scripts/compose-bundle-patch.mjs --check    # 断言 cordis.patch.yml == presets/* 合成结果
dsh --profile web --dump-config | grep -A3 'id: preset-flash-lean-ptc-v3'
```

## 如何选择

| 预设 | id | order | 规则条数 | 压缩 | 适用 |
|---|---|---|---|---|---|
| v1 | `flash-lean-ptc-v1` | 21 | 14 | 0.3 / 50k | 需要更多上下文余量、任务偏长 |
| v2 | `flash-lean-ptc-v2` | 22 | 12 | 0.25 / 20k | 与 v1 同代但更省，保守选择 |
| **v3** | `flash-lean-ptc-v3` | 27 | 13 | 0.25 / 20k | **默认**：日常与攻坚都用它 |

三者可共存、随时切换，不影响其它 profile。

## 关键配置

- `compaction-basic`：`thresholdRatio 0.25` / `retainTokens 20000` / `compactionRetries 2`。
- `compaction-tool-result-pruner`：`thresholdChars 8192` / `headChars 4096` / `tailChars 1024`。
- `tool-presentation`：`mode: ptc`（单入口 `run_code`，批处理成本更低）。
- `tool-workflow`：停用（新版出厂默认已停用，这里显式写死避免回退）。
- 平台标签：补丁里用 `!!js process.platform === 'win32'` 切换 bash / pwsh——这是 DSH 加载器自己的标签，第三方 YAML 解析器会报 unknown tag，属工具兼容性问题。

## 行为约束（v3）

v3 的 persona 后缀共 13 条编号规则，可归为四组：

1. **预算**：按轮不按步；超过预期轮数（约 60 轮）就停下来重新规划，而不是重复同一个循环。
2. **动手顺序**：先做一个短判断，再跑一次廉价探测；不做"先设计完再动手"。
3. **验证**：验收门通过即交付，不追加随机/压测轮；失败时只补失败项。
4. **交付**：报告实际通过数与失败项，不用"已覆盖子任务 X~Y"代替结论。

## 实测结果

全部为 **DSH headless + PTC** 实测（2026-10）。样本小，按"方向性"读。

| 场景 | 结果 |
|---|---|
| P15654（19 组官方样例），原题面 | v3 满分率 **1/3**，两次失败均为 4.00 / 4.01 s（限 4 s）= 常数卡边界 |
| 同上，题面要求"留可复跑 verify.log 且必须全过" | **3/3 满分**，总成本反而低 35%（17.5 M vs 26.8 M） |
| P15114（32 MB 内存陷阱）写明限制 | 旧题面 60 分 → 写清限制后 **100 分** |
| P2099（提交答案、连续评分）只判"合法" | 提前收工，比值 **1.05–1.15**，比标准模式差 |
| 同题，判"合法且比值 ≤1.05"并回灌失败清单 | **1.05 / 1.03 / 0.98**，两次靠第二轮救回 |
| 受控复现（n=2，全对） | v3 计费 4.64 M vs 标准 7.03 M；墙钟 759 s vs 719 s |

一句话：**分数差距的绝大部分来自"验收标准没写死"，不是"模型不会"。**

## 兼容性

| 项目 | 状态 |
|---|---|
| DSH **0.2.1-rc.2** | ✅ 模拟安装后 `--dump-config` 正常合成，三预设均可见 |
| DSH 0.1.7 ~ 0.2.0 | ✅ 同一插件行机制（安装器逻辑未变） |
| DSH < 0.1.7 | ⚠️ 仅 `v1` 提供旧式目录（`presets/legacy-0.1.5/`） |
| profile：web / desktop / headless / acp | ✅ web 为 live reload，其它需重启 |
| Windows / Linux / macOS | ✅ 安装器三平台 CI；macOS 未做真机验证 |
| 第三方 YAML 解析器 | ⚠️ 遇 `!!js` 标签会报 unknown tag（DSH 自身正常） |

## 已知限制

1. **"让模型先评估难度再问用户"无效。** 2026-10-20 对照：只加验收契约块（B 臂）中位比值 1.05，契约 + 提问 + 答复（C 臂）1.06，都**不如**直接开跑的 1.02。起作用的是外部判分 + 回灌失败清单。
2. **不要把证明不了的东西写进预设。** 同题同预设，一次 166 s 满分、一次 1183 s 只到 15/19——难度事前不可预测，所以预设里没有"难度自适应"规则。
3. **模型自测报告不可信。** 实测出现过"声称逐组跑完 19 组样例"而工作区没有任何比对脚本。所以要留**可复跑产物**，而不是要求它诚实。
4. **PTC 之外的模式没有同规模对照**，native 的成本结构不同，别直接套用本文数字。
5. 本包只装预设行，**不携带任何工具**；profile 缺插件时对应行会失效（安装器不会补依赖）。

## 仓库结构

```
presets/                       预设源文件（唯一事实来源）
  flash-lean-ptc-v1.patch.yml
  flash-lean-ptc-v2.patch.yml
  flash-lean-ptc-v3.patch.yml  ← 主版本（lean-v3）
  legacy-0.1.5/                DSH < 0.1.7 目录式回退（仅 v1）
cordis.patch.yml               由 presets/* 合成，勿手改（CI 断言一致性）
scripts/
  install.sh / install.ps1     安装器（共用 merge-presets.mjs）
  merge-presets.mjs            托管块写入 / 移除
  compose-bundle-patch.mjs     合成组合包补丁层
  verify-presets.mjs           结构与取值断言（逐预设切片）
  verify-yaml.mjs              YAML 与平台标签检查
  selftest.sh                  端到端自测
docs/                          文档与历史 README
.github/workflows/verify.yml   三平台安装矩阵 + 组合包安装断言
```

## 版本历史

### v0.2.1（2026-10-20）

- `v3`（lean-v3）定稿为主版本：v3b 基线 + 反过度自测；`order 27`、13 条规则、压缩 0.25 / 20k。
- 安装器、合成器、校验器全部支持三预设（此前多处硬编码 v1 + v2）。
- `verify-presets.mjs` 改为**逐预设切片断言**（压缩阈值、保留预算、规则条数、order 各自核对），不再对整块做宽松匹配。
- 对齐 DSH 0.2.1-rc.2 完成模拟安装回归。

### v0.2.0（2026-09-30）

- 声明为 DSH 组合包（`dsh.bundle`）；单文件 `cordis.patch.yml` + 合成脚本 + CI 真实安装校验。
- 新增 `v2`：步数预算、少想多试、一次合并验证、先交最小可行产物。

### v0.1.0（2026-09-23 ~ 09-24 · 首个发布）

- `v1` 基线：压缩 0.3 / 50k、14 条行为约束、PTC 展示层。

## 文档

[实测证据](docs/实测证据.md) · [版本与兼容性](docs/版本与兼容性.md) · [0.2.0 历史 README](docs/README-0.2.0.md) · [变更日志](docs/CHANGELOG.md)

## 许可证

[MIT](LICENSE)。

## 维护者

<table>
  <tbody>
    <tr>
      <td align="center" width="150"><a href="https://github.com/LarryE135"><img src="https://github.com/LarryE135.png?size=160" width="96" height="96" alt="LarryE135"></a><br><a href="https://github.com/LarryE135"><b>LarryE135</b></a></td>
    </tr>
  </tbody>
</table>

---

## English summary

Flash-tier agent presets for DSH, shipped as a patch-only bundle (`dsh.bundle`) that inserts `@deepseek-ai/dsh-agent-preset` rows into a profile. Three presets: `v1` (baseline, compaction 0.3/50k, 14 rules), `v2` (tighter, 0.25/20k, 12 rules), `v3` (current, `lean-v3`, 0.25/20k, 13 rules — stops once the acceptance gate passes). No runtime code, no `main`, no `prepare`. Verified against DSH 0.2.1-rc.2 with a simulated install (temp `DSH_HOME` → install → `--dump-config` shows all three → idempotent re-install → clean uninstall). Known limitation: prompt-level "difficulty assessment / clarifying questions" did not beat plain runs in our measurements; an external grader plus a failing-items feedback loop did.

Install: `dsh plugin --profile web add github:LarryE135/dsh-flash-presets` (or `bash scripts/install.sh --profile web`).
