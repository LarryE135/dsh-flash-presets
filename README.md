<p align="center"><strong>dsh-flash-presets</strong></p>

<p align="center"><strong>中文</strong> | <a href="#english-summary">English</a></p>

<p align="center">
  <a href="https://github.com/LarryE135/dsh-flash-presets/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/LarryE135/dsh-flash-presets?style=flat-square&color=eab308"></a>
  <a href="https://www.npmjs.com/package/dsh-flash-presets"><img alt="npm" src="https://img.shields.io/npm/v/dsh-flash-presets?style=flat-square&color=cb3837"></a>
  <a href="https://www.npmjs.com/package/dsh-flash-presets"><img alt="npm downloads" src="https://img.shields.io/npm/dm/dsh-flash-presets?style=flat-square&color=cb3837"></a>
</p>

# dsh-flash-presets

面向 DeepSeek V4.1 Flash 这一档路由的 DSH agent 预设，以 DSH 组合包（`dsh.bundle`）形式交付。安装后向 profile 的插件列表插入三个预设行（`@deepseek-ai/dsh-agent-preset`）与一行**只写日志、永不阻断启动**的宿主自检插件（`flash-presets-selfcheck`），不动共享工具注册表。

预设影响三件事：预算与轮数（按轮计，不按步计）、工具输出的折叠与裁剪、判定任务完成的标准。它不提升模型能力，只决定一次会话花多少轮、在哪一步停下、用什么标准收尾。

> [!IMPORTANT]
> 当前版本：v0.2.2（分支 0.2.2，与 npm 已发布版本一致），`v3`（内部代号 lean-v3）是主版本，对齐 DSH 0.2.1-rc.2。
> 已验证：三平台安装器回归；模拟安装（临时 `DSH_HOME` 安装后用 `dsh --dump-config` 合成出三个预设与自检行，重复安装幂等，卸载后依赖 / bundle 选择 / patch 层无残留）；`engines.dsh` 兼容门负向（版本不满足时安装被拒）；plan-mode section 与 0.2.1-rc.2 上游逐词一致（CI 漂移检查）；组合包合成一致性。
> 未验证：macOS 真机；native 模式的同规模对照。
> 数字与失效场景见 [实测证据](docs/实测证据.md)、[基准与消融](docs/BENCHMARKING.md) 及下文「已知限制」。

## 预设

| 预设 | id | order | 规则条数 | 压缩 | 用途 |
|---|---|---|---|---|---|
| v1 | `flash-lean-ptc-v1` | 21 | 14 | 0.3 / 50k | 上下文余量优先，任务偏长 |
| v2 | `flash-lean-ptc-v2` | 22 | 12 | 0.25 / 20k | 与 v1 同代，更省，保守选择 |
| v3 | `flash-lean-ptc-v3` | 27 | 13 | 0.25 / 20k | 默认 |

三者可同时安装，在预设列表里逐项选择，互不影响。

v3 相对 v2 的改动集中在验证阶段：验收门通过即交付，不再追加随机测试与压测轮。改动针对的实测现象是失败模式从「答案错误」迁移到「超时」与「单个任务耗时过长」。

## 安装、更新、卸载

### npm（推荐）

```console
npm install -g dsh-flash-presets          # 全局装一份，供任意 profile 引用
dsh plugin --profile web add dsh-flash-presets
```

包地址：<https://www.npmjs.com/package/dsh-flash-presets>。`dsh plugin add` 会自动把本包写入该 profile 的依赖并加载 `cordis.patch.yml`，无需先手动 `npm install`；上面前一行只在你需要离线副本或想让多个 profile 共用时才有必要。

在 GUI 的「插件 → 添加插件」里填 `dsh-flash-presets`，效果相同。

版本策略：不带版本号时管理器写入的是 caret 范围（如 `^0.2.2`），后续任何 pnpm 操作都可能把它带到 0.2.x 最新版。预设直接决定 agent 行为，**要可复现就写死版本**：

```console
dsh plugin --profile web add dsh-flash-presets@0.2.2   # 锁死（当前已发布版本）
```

### GitHub 直装

```console
dsh plugin --profile web add github:LarryE135/dsh-flash-presets#v0.2.2   # 锁死 tag（推荐）
dsh plugin --profile web add github:LarryE135/dsh-flash-presets          # 跟 main，适合未发布分支/本地改动
```

同样写在 GUI 的「插件 → 添加插件」里也能装。**不带 `#tag` 的 git 直装是移动目标**：pnpm 每次重解析都可能取到 main 的最新提交，预设行为随之漂移——要可复现就用 `#v0.2.2`。

`--profile` 取 `web`、`desktop`、`headless`、`acp` 之一。管理器把本包写入该 profile 的 `dsh.profile.bundles`，并把 `cordis.patch.yml` 里的条目（宿主自检行 + v1、v2、v3 三个 insert）叠加到该 profile。`web` 为 live reload，刷新界面即可见；其他 profile 需重启。

更新：CLI 下重复执行同一条 `add`（或先 `remove` 再 `add`）；GUI 的「添加插件」对已装包在 HMR profile（web）下会报 `already-installed`——先移除再安装。卸载时把本包从 `dsh.profile.bundles` 与依赖中移除后重装依赖；由脚本写入的托管块用 `scripts/install.sh --uninstall` 清除。

### 版本兼容门（engines.dsh）

package.json 声明 `engines.dsh: ">=0.1.7-rc.1 <0.3.0"`。DSH 插件管理器安装/激活时会校验它：版本不满足即拒绝，而不是装上后静默失效（0.1.7 以前只有 v1 的目录式回退，0.3 起视为未知破坏面）。CI 里有负向用例证明该门生效。

### 宿主自检插件

安装后 profile 里会多一行 `flash-presets-selfcheck`（`lib/selfcheck.mjs`）。它在每次启动后校验：三个预设行是否在组合里、关键配置键（压缩阈值/裁剪/PTC）是否齐备、agent-preset-registry 是否把某个预设标记为 broken——发现问题只在日志里报警，**永不阻断启动**。关掉它：在 profile 的 `cordis.patch.yml` 里加

```yaml
- id: flash-presets-selfcheck
  disabled: true
```

### 脚本

```bash
git clone https://github.com/LarryE135/dsh-flash-presets.git
cd dsh-flash-presets
```

Linux / macOS / WSL / Git Bash：

```bash
bash scripts/install.sh                         # DSH 0.1.7+ 写 profile 补丁；更旧版本回退到目录式
bash scripts/install.sh --profile desktop       # 默认 web
bash scripts/install.sh --uninstall
DSH_HOME=/path/to/.dsh bash scripts/install.sh
```

Windows（PowerShell 5.1+ 或 7）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install.ps1
.\scripts\install.ps1 -Profile desktop
.\scripts\install.ps1 -Uninstall
.\scripts\install.ps1 -DshHome D:\tmp\.dsh
```

两个安装器共用 `scripts/merge-presets.mjs`：先备份 `cordis.patch.yml.bak-<时间戳>`，再整块替换托管块，可重复执行。

### 校验

```console
node scripts/verify-presets.mjs                  # 结构与取值断言，可用 DSH_HOME / DSH_PROFILE 指向模拟安装
node scripts/verify-yaml.mjs                     # YAML 与跨平台标签检查
node scripts/compose-bundle-patch.mjs --check    # 断言 cordis.patch.yml 与 presets/* + 自检行一致
node scripts/sync-marketplace.mjs --check        # 断言 marketplace/plugin.json 与 package.json 同步
node scripts/check-planmode-drift.mjs --dump dump.txt --dsh 0.2.1-rc.2   # plan-mode section 与上游漂移检查
node bench/run.mjs --list                        # 基准题库与消融（docs/BENCHMARKING.md）
dsh --profile web --dump-config | grep -A3 'id: preset-flash-lean-ptc-v3'
```

## 配置

- `compaction-basic`：`thresholdRatio 0.25`、`retainTokens 20000`、`compactionRetries` 为 v1=2、v2 与 v3=1。
- `compaction-tool-result-pruner`：`thresholdChars 8192`、`headChars 4096`、`tailChars 1024`。
- `tool-presentation`：`mode: ptc`，单入口 `run_code`。
- `tool-workflow`：停用。新版出厂默认已停用，这里显式写死，避免上游改回默认值时静默生效。
- 平台分支：补丁用 `!!js process.platform === 'win32'` 在 bash 与 pwsh 之间切换。该标签由 DSH 加载器在挂载时求值——**装插件 = 授权其补丁层执行表达式**，请只从可信来源安装；第三方 YAML 解析器不认该标签。
- plan-mode `section`：预设里冻结了 DSH 内置 plan-mode 政策的一份拷贝（对齐 0.2.1-rc.2 上游措辞）。上游改了这里不会自动跟着变，CI 的漂移检查（`check-planmode-drift.mjs`）在两者脱节时让构建失败，逼维护者同步。

### 按路由调压缩（modelPolicies）

v3 的 `compaction-basic` 支持 DSH 0.2.1+ 的按模型策略：`modelPolicies` 按 provider/model 精确匹配，不匹配即回退上方全局默认（0.25/20k）。预设里留了注释模板：

```yaml
modelPolicies:
  - provider: deepseek-official
    model: deepseek-flash
    thresholdRatio: 0.2
    retainTokens: 16000
```

启用方法：把 `presets/flash-lean-ptc-v3.patch.yml` 里对应注释去掉（或装完后在 profile 补丁里覆盖 `preset-flash-lean-ptc-v3` 行），并按 `dsh --profile <p> --dump-config` 里 `agent-default-model` 的实际 provider/model 改写。persona 规则 13 的路由感知与这个配置是一对：行为提示 + 真实阈值。

## 行为约束

v3 的 persona 后缀含 13 条编号规则，分五类：

1. 预算（规则 1）：按轮计不按步计；超过预期轮数（约 60 轮）就停下重新规划，不重复同一个循环。
2. 动手顺序（规则 2–3）：先做一次短判断并跑一次廉价探测，不把设计全部展开再动手；提交答案型任务先产出最小可行产物。
3. 验证（规则 4）：验收门通过即交付，不追加随机测试与压测轮；失败时只补失败项。
4. 工具与输出（规则 5–9）：读文件用 read/glob/grep 而不是 shell 浏览；批量调用；按需折叠；控制上下文；增量改写。
5. 交付与范围（规则 10–13）：按用户语言回答、遵守范围；不把密钥写进会话；两次失败换路子；按路由与模型调整策略。

## 实测

以下为 DSH headless 与 PTC 模式的批量运行结果，时间 2026 年 10 月，每组样本量 2 到 3。

在 P15654（19 组官方样例，时限 4 s）上，v3 用原题面三次只有一次满分，两次失败分别为 4.00 s 与 4.01 s，都卡在时限上。同一预设换成要求留下可复跑 `verify.log` 且必须全过的题面后三次全部满分，合计计费 17.5 M，低于原题面的 26.8 M，其中两次由第二轮修正（16 到 19、15 到 19）。标准模式在该题两次均满分，洛谷实测 100 分。

在 P2099（提交答案，连续评分）上，标准模式四次比值为 0.99、1.09、1.04、1.05。v3 只判合法性时比值为 1.05 到 1.15，低于标准模式；改为判「合法且比值不超过 1.05」并回灌失败清单后为 1.05、1.03、0.98，其中两次由第二轮修正。

P15114 与受控复现的完整数字见 [实测证据](docs/实测证据.md)。

跨场景能成立的说法只有一条：分数差距主要来自判定标准是否写死，与模型能力关系不大。

## 兼容性

本仓库在 DSH 0.2.1-rc.2 上做过模拟安装回归：临时 `DSH_HOME` 安装后用 `--dump-config` 合成出 v1、v2、v3 与自检行，重复安装幂等，卸载后依赖、`dsh.profile.bundles` 选择与 patch 层均无残留（pnpm 在 profile 的 `pnpm-workspace.yaml` 里留下的 `minimumReleaseAgeExclude` 记录不属于本包，卸载时不会清除，也不影响配置合成）。0.1.7 到 0.2.0 走同一套插件行机制，安装器逻辑未改。0.1.7 以前只有 v1 提供 `presets/legacy-0.1.5/` 的目录式回退，v2 与 v3 不支持。web profile 为 live reload，desktop、headless、acp 需重启，因为 provider 补丁层只在启动时读取。

版本门（`engines.dsh: >=0.1.7-rc.1 <0.3.0`）由 DSH 插件管理器在安装与激活时校验，负向用例在 CI 里。超出范围想强行用：DSH 提供 exact-version 豁免（`dsh plugin allow-version`），但那是自担风险。

安装器在 Windows PowerShell、Linux、WSL 上跑过三平台 CI。macOS 未在真机验证，脚本按 bash 3.2 兼容写，变量后接非 ASCII 字符时用 ${var}。

## 已知限制

「先让模型评估难度、再向用户提问」这条路径在实测中无效。2026-10-20 的对照里，只加验收契约块的一臂中位比值 1.05，契约加提问与答复的一臂 1.06，都低于直接开跑的 1.02。有效的是外部判分加回灌失败清单。预设里因此没有难度自评与开工前提问。

**选中本预设 = 会话的工具面被替换**：预设 realm 就是会话的 agent 侧组合，`config.plugins` 里没列的工具（视觉工具、浏览器、MCP、日程等 profile 里装的其它插件）在该会话中不可用。这是「精简」的代价，请按需把工具补进预设行，或换用上游 standard 预设。预设的工具清单必须随 DSH 发版维护（新增官方工具不会自动进入）。

**规则是软约束**：轮数预算、验收门都是 persona 散文，没有运行时强制；模型可以无视。压缩阈值等硬参数才是确定生效的部分。

**冻结的上游文案会漂移**：plan-mode `section` 是 0.2.1-rc.2 上游政策的快照（CI 有漂移检查，但 DSH 发新版后仍需人工跟进）。

此外，为方便量化，本插件的开发和测试都围绕洛谷公开题库展开，按 token 消耗、完成用时、步数、运行内存占用与耗时加权评价，难免有局限；`bench/`（见 [基准与消融](docs/BENCHMARKING.md)）提供可持续的本地回归，但 seed 题同样只覆盖一小类任务。

## 注意事项（人工与 AI 协助者都看）

1. 使用本插件时把输出上限设到 120K 以上，有条件直接拉满 384K，避免长时间集中思考被截断。

2. 本插件只保证对 DeepSeek V4.1 Flash 有效，不保证对其他模型有效。

3. 实际使用时先给出明确的目标或验收标准，越明确效果越好；边界不清楚时配合 plan mode 使用。

4. 桌面版或 Windows 端用户，建议先安装并启用 MSI 版 PowerShell 7 或 Git Bash——实测这一项本身就能带来不少提升；不知道怎么装可以问大肥鱼。

5. 本包只安装预设行 + 自检行，不携带工具：profile 缺对应插件时预设行会失效（自检插件会在日志里报警），安装器也不会补齐依赖。

6. 选预设前看「已知限制」：预设会替换会话的工具面（未列出的工具不可用），不是叠加。

## 仓库结构

```
presets/
  flash-lean-ptc-v1.patch.yml
  flash-lean-ptc-v2.patch.yml
  flash-lean-ptc-v3.patch.yml     主版本（lean-v3）
  legacy-0.1.5/                   DSH 0.1.7 以前的目录式回退，仅 v1
lib/selfcheck.mjs                 宿主自检插件（只写日志，永不阻断启动）
cordis.patch.yml                  由 presets/* + 自检行合成，勿手改，CI 断言一致性
bench/
  problems/seed/                  自包含题库（题面 + 数据 + judge.mjs）
  run.mjs                         评测 runner（--strip-rules 做规则消融）
  gate.mjs                        回归门（分数/计费/墙钟越限即失败）
scripts/
  install.sh / install.ps1        安装器，共用 merge-presets.mjs
  merge-presets.mjs               托管块写入与移除
  compose-bundle-patch.mjs        合成组合包补丁层
  verify-presets.mjs              结构与取值断言，逐预设切片
  verify-yaml.mjs                 YAML 与平台标签检查
  sync-marketplace.mjs            marketplace/plugin.json 与 package.json 同步
  check-planmode-drift.mjs        plan-mode section 与上游漂移检查
  check-ps1.mjs                   PowerShell 侧静态审查（BOM、完成文案、标签守卫）
  check-bash32-cjk.mjs            macOS bash 3.2 的多字节变量守卫
  selftest.sh                     端到端自测
  publish.sh / publish.ps1        推送与建 Release，版本号从 README 解析
docs/PUBLISHING.md                维护者发布流程（npm + 标签 + Release + 收尾）
docs/                             文档与历史 README
.github/workflows/verify.yml      三平台安装矩阵 + 组合包安装/漂移/兼容门断言
.github/workflows/bench.yml       每周基准 + 回归门（有 API key 时跑真模型）
```

## 版本历史

### 未发布（计划 0.2.3）

> 内容已随 PR 合入 main，但**版本口径保持 0.2.2**（与 npm 已发布版本一致）；合并后按 [docs/PUBLISHING.md](docs/PUBLISHING.md) 发 npm 并打 tag `v0.2.3`，届时把「当前版本」与一键命令的 `@0.2.2` / `#v0.2.2` 转正为 0.2.3。

- 修正与事实相反的陈述：`docs/版本与兼容性.md` 里 npm 渠道仍写「registry 返回 404，尚未发布」→ 改为 0.2.2 起可用。
- 「卸载无残留」收窄为「依赖 / `dsh.profile.bundles` 选择 / patch 层无残留」，并注明 pnpm 的 `minimumReleaseAgeExclude` 记录会留在 profile。
- npm / GitHub 安装段补版本策略：默认写入 caret 范围、git 直装是移动目标——预设改行为，要可复现请写死版本（`@0.2.2` / `#v0.2.2`，发布 0.2.3 后转正）。
- **版本兼容门**：package.json 声明 `engines.dsh: ">=0.1.7-rc.1 <0.3.0"`，不满足的 DSH 拒绝安装（CI 负向用例）；README 补 GUI 与 CLI 的更新语义差异（web/HMR 下 GUI 重装报 `already-installed`，需先移除）。
- **plan-mode 漂移修复与防线**：三个预设的 plan-mode `section` 对齐 0.2.1-rc.2 上游措辞（「until the user approves your plan through exit_plan_mode」）；新增 `scripts/check-planmode-drift.mjs`（零依赖，逐词对比 `--dump-config` 里的上游 section）+ CI 步骤 + `docs/plan-mode-drift.json` 书面豁免通道；`verify-yaml.mjs` 加措辞守卫防回退。
- **陈旧注释修正**：v2/v3 的 `FLASH TUNING` 注释原为 v1 的「300k 触发 / 保留 50k」，与实际配置（0.25 → 250k / 20k）矛盾，已改并注明依据。
- **按路由调压缩**：v3 的 compaction-basic 增加 `modelPolicies` 注释模板（按 provider/model 精确匹配、不匹配即回退），persona 规则 13 与之联动；README「按路由调压缩」说明启用方法。
- **宿主自检插件**：新增 `lib/selfcheck.mjs` 与 bundle 里的 `flash-presets-selfcheck` 行——启动后校验预设行存在性、关键配置键、registry broken 状态，只写日志永不阻断启动，可在 profile 补丁层 `disabled: true` 关闭。
- **marketplace 同步**：新增 `scripts/sync-marketplace.mjs`，version/descriptionZh/安装指向从 package.json 派生，CI 断言同步（修复 marketplace 停留在 0.2.1 的漂移）。
- **基准与消融管线**：新增 `bench/`（3 道自包含 seed 题 + judge.mjs + runner + 回归门）+ `docs/BENCHMARKING.md` + `.github/workflows/bench.yml`（每周自动跑；配 `DEEPSEEK_API_KEY` secret 时跑真模型并执行回归门，否则只跑 smoke）。`--strip-rules N,M` 支持规则消融对照。
- **供应链与行为文档**：README 明确 `!!js` 标签在挂载时求值（装插件 = 授权表达式执行）、预设替换会话工具面（未列出的工具不可用）、规则是软约束、上游文案会漂移四条已知限制。
- `verify-presets.mjs` / `verify-yaml.mjs` 相应扩展（自检行、engines 门、marketplace 版本、v3 条目与措辞守卫）。

### v0.2.2（2026-10-21）

- 发布到 npm：`dsh-flash-presets`，可直接 `dsh plugin --profile web add dsh-flash-presets` 安装。
- `verify-presets.mjs` 修正安装层判定的两个误报：只装 v3（常态）时不再因 v1/v2 缺失而报 25 项失败；预设行写在托管块之外（`dsh plugin` 合并的形态）时也能正确切片。
- 新增开关：`--repo-only` 只跑仓库层（供发布前守卫与 CI 使用），`--all` 要求三个预设都已安装。
- `package.json` 增加 `prepublishOnly` 守卫：合成一致性 + YAML 校验 + 仓库层结构校验，任一失败即中止发布。

### v0.2.1（2026-10-20）

- `v3`（lean-v3）定为主版本：order 27、13 条规则、压缩 0.25 / 20k。
- 安装器、合成器、校验器支持三个预设。此前多处只处理 v1 与 v2。
- `verify-presets.mjs` 改为逐预设切片断言，分别核对 order、规则条数、压缩阈值、保留预算、裁剪阈值、PTC 与 tool-workflow。
- 对齐 DSH 0.2.1-rc.2 完成模拟安装回归。

### v0.2.0（2026-09-30）

- 声明为 DSH 组合包：单文件 `cordis.patch.yml`、合成脚本、CI 真实安装校验。
- 新增 `v2`：步数预算、少想多试、一次合并验证、先交最小可行产物。

### v0.1.0（2026-09-23 至 09-24）

- 首个发布：`v1`，压缩 0.3 / 50k、14 条约束、PTC 展示层。
- 更早的 `v1.0.0`、`v1.0.1`、`v1.1.0` 三个标签属于同一代（0.1.x 之前），已折叠进本版；标签保留，指向 2026-09-23 至 09-24 的提交。

## 文档

[实测证据](docs/实测证据.md)、[版本与兼容性](docs/版本与兼容性.md)、[基准与消融](docs/BENCHMARKING.md)、[0.2.0 历史 README](docs/README-0.2.0.md)、[变更日志](docs/CHANGELOG.md)

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

Flash-tier agent presets for DSH, shipped as a bundle (`dsh.bundle`) whose patch inserts three `@deepseek-ai/dsh-agent-preset` rows plus one host-level self-check row (`lib/selfcheck.mjs`; logs only, never blocks startup). Three presets: `v1` (compaction 0.3/50k, 14 rules), `v2` (0.25/20k, 12 rules), `v3` (current, 0.25/20k, 13 rules, stops once the acceptance gate passes). No other runtime code. Declares `engines.dsh: ">=0.1.7-rc.1 <0.3.0"` so the plugin manager rejects unsupported DSH versions (CI includes a negative test). Verified against DSH 0.2.1-rc.2 with a simulated install: temp `DSH_HOME`, install, `--dump-config` shows all three presets plus the self-check row, idempotent re-install, clean uninstall; the frozen plan-mode section is word-diffed against the upstream shipped section in CI (`check-planmode-drift.mjs`). Not verified on macOS hardware, and no same-scale comparison for native (non-PTC) mode.

Measured in our runs: writing the acceptance criteria into the prompt moved P15654 from 1/3 to 3/3 at 35% lower cost; an external grader with a failing-items loop moved P2099 from 1.05-1.15 to 1.03 median. Prompt-level difficulty assessment and clarifying questions did not help. `bench/` adds a self-contained problem set with judges, a headless runner (same billing metric: inputTokens + cacheReadTokens), rule-ablation support (`--strip-rules`), and a regression gate; a weekly workflow runs it when a `DEEPSEEK_API_KEY` secret is configured.

Install from npm: `dsh plugin --profile web add dsh-flash-presets@0.2.2` (pin it), or from git: `github:LarryE135/dsh-flash-presets#v0.2.2`, or run `bash scripts/install.sh --profile web` after cloning.
