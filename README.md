<p align="center"><strong>dsh-flash-presets</strong></p>

<p align="center"><strong>中文</strong> | <a href="README.en.md">English</a></p>

<p align="center">
  <a href="https://github.com/LarryE135/dsh-flash-presets/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/LarryE135/dsh-flash-presets?style=flat-square&color=eab308"></a>
  <a href="https://www.npmjs.com/package/dsh-flash-presets"><img alt="npm" src="https://img.shields.io/npm/v/dsh-flash-presets?style=flat-square&color=cb3837"></a>
  <a href="https://www.npmjs.com/package/dsh-flash-presets"><img alt="npm downloads" src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FLarryE135%2Fdsh-flash-presets%2Fbadges%2Fbadges%2Fdownloads.json&style=flat-square"></a>
</p>

# dsh-flash-presets

为 DeepSeek V4.1 Flash 调校的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）agent 预设。

核心要素：更短的上下文窗口，工具裁切，低频工具优化，run_code合并调用。本插件无法改变模型能力上限，但能以更低的预算完成模型能力范围内的任务。

整个包以 DSH 组合包（`dsh.bundle`）交付：向 profile 插入预设行，不改宿主源码。**有三项是运行时对整个 profile 生效的**：常驻 PTC 运行时（补丁里的 `ptc-runtime` 覆盖，作用到该 profile 的**所有**预设，要关只能移除这张插件卡）、`glob` / `grep` 的只读并发标记（`DSH_FLASH_PRESETS_CONCURRENCY=0` 关闭）、旧 preset id 的解析（`DSH_FLASH_PRESETS_ALIAS=0` 关闭）。

> 当前版本：v0.3.2（2026-11-17 追认为正式版 —— npm 的 `latest` dist-tag 指向它，npm 侧一律以 `npm view dsh-flash-presets version` 为准）· 误发版本 v0.3.3（npm 上仍可安装、已 `deprecate`，**不是正式版**；它的包**比 0.3.2 少第四轮 6 项修复**，别当等价替代 —— 仓库 `package.json` 现在写的就是 0.3.2）· 预设 v3 / v3 balance · 计划模式 plan-mode v1（1.0.0）· 要求 DSH `>=0.2.1-rc.5 <0.2.3-0`（`engines` 闸：安装时会拒装，启动加载时区间外的 DSH 会跳过本插件，可用 `dsh plugin allow-version` 自担风险放行；脚本安装不经过这道闸），实测 0.2.1-rc.5 与 0.2.2-rc.1
>
> 正式版：tag `v0.3.2` + npm 0.3.2 + GitHub Release 同日落地（用 `npm view dsh-flash-presets version` 复核；若还显示 0.3.1，说明镜像/缓存未刷，可用 `#v0.3.2` 装同一份代码）。上一版正式版是 0.3.1。**0.3.3 是误发版本**：原计划按 0.3.2 发布，`package.json` 被写成 0.3.3 且已 `npm publish` —— 现在的处置是把 0.3.2 追认为正式版，0.3.3 在 npm 上 `deprecate`（仍可安装，但不是正式版）。所以**装包务必写死版本号**：`^0.3` 这类范围仍可能解析到 0.3.3。0.3.2 收口两轮外部审计、第三轮自查与第四轮审计的修复：宿主事件形态、改档位丢自动批准、评审守卫、交付门挂起与 Windows 支持、面板 Host 白名单、发布脚本互锁、安装器认领边界 —— 其中 `run_code` 优化随安装即生效。**不要装 0.2.5** —— 它在 DSH 0.2.2-rc.1 上无法新建会话（#19）。

## 适合谁，不适合什么

**适合**

- 目标清楚、有验收标准的任务：改代码、跑脚本、整理数据、按格式出交付物。
- 长会话。默认压缩阈值是上下文的 80%，多数会话根本触发不了；本预设改为 25%，长会话的上下文因此保持在可控范围。
- 在意 token 账单、又不想在每条消息里反复叮嘱模型的人。

**不适合**

- 明显超出模型能力的难题，比如竞赛级、以拿部分分为目标的题目。这类任务上标准模式更稳，数据见[实测证据](docs/实测证据.md)。
- 依赖当前日期、在对话里装插件、或定时任务的工作流。这些能力在预设里被去掉了（见[与官方 PTC 预设的差异](#与官方-ptc-预设的差异)）。
- DeepSeek V4.1 Flash 以外的模型。规则可能仍然有用，但没有验证。
- DSH 低于 0.2.1-rc.5 的版本（含 0.2.1-rc.2～rc.4）。旧版本请用对应的旧版包（见[版本与兼容性](docs/版本与兼容性.md)）；DSH 0.1.7 以前的目录式预设，0.2.6 起不再提供。

## 它做了什么

四个机制分别作用在会话的四个时刻，彼此不重叠：

| 机制 | 作用时刻 | 设置 | 效果 |
|---|---|---|---|
| 轮次压缩 | 上下文存量过大时 | `thresholdRatio: 0.25`，`retainTokens: 20000`（官方默认 0.8） | 历史换成摘要，长会话才触发 |
| 工具输出裁剪 | 工具结果进入上下文时 | 头 4096 / 尾 1024 字符 | 每条过长输出只留两端 |
| 关闭插件 | 组装系统提示时 | 6 个插件 `disabled: true` | 这些工具的 schema 不进提示，固定省一笔 |
| 行为纪律 | 模型每一步决策时 | persona 规则（lean-v3 13 条，balance 3 条） | 引导少读、批量调用、增量改写 |

另外两项runcode优化随包生效：

- 工具面使用 PTC（`tool-presentation: ptc`），PTC 运行时改为会话内常驻（`ptc-runtime: persistent-in-memory`）。实测每个 program 的固定启动成本从 108 ms 降到约 0（按收益模型计），嵌套工具调用从 44 ms 降到 15 ms（[压测记录](https://github.com/LarryE135/dsh-flash-presets/blob/main/docs/压测-run_code开销.md)）。收益随单个 program 内的调用次数线性增长，只跑一条命令的短任务几乎无感。
- 插件在运行时为 `glob` / `grep` 补上只读并发标记，同一轮里的多个搜索可以并行执行。启动日志里会打一行自检，排障只认它：

  ```
  [tool-concurrency] v0.3.2 生效｜targets=glob,grep｜sweep=500ms｜witness=glob=true grep=true｜scopes=1
  ```

逐项原理与源码行号见[技术文档 · 省 token 的四套机制](docs/技术文档-省token四机制.md)。

## 预设：lean-v3 + balance

| 预设 | id | 规则 | 压缩 | 何时用 |
|---|---|---:|---|---|
| 精简·PTC v3（lean-v3） | `flash-lean-ptc-v3` | 13 | 0.25 / 20k | **默认**。效率最高的版本，适合绝大多数日常工作 |
| 精简·PTC v3 balance | `flash-lean-ptc-v3-balance` | 3 | 0.25 / 20k | 约束更弱，适合需要模型发挥的场景 |

两张卡共享同一套压缩/裁剪框架与插件配置，区别只在 persona 规则文本。

**不随包发行的 id**（需要就自己在 profile 补丁里加行）：

- `flash-lean-ptc-v1`（14 条 / 0.3·50k）、`flash-lean-ptc-v2`（12 条 / 0.25·20k）：0.2.5 的规则。
  规则与 v3 不同，但**仍然映射**到 `flash-lean-ptc-v3`（打得开优先），标 `rulesDiffer` 并在首次命中时打印
  警告；要原规则的就在自己的 profile 补丁里加行，源文件见 tag `v0.2.5`。
- 0.2.6–0.2.8 的 `flash-lean-ptc-v3-lite`、更早的 `flash-lean` / `flash-lean-ptc`：同样由别名层解析到
  `flash-lean-ptc-v3`，不占卡片。

> 脚本安装**没有**别名层（只有插件卡有）：上面这些历史 id 的会话要打开，就在自己的 profile 补丁里加回原行 ——
> 安装器现在会保留你加的 v1 / v2 行（第六轮审计 U1-2 之前它会把它们当残留删掉）。

lean-v3 的 13 条规则分五组：预算（按轮而不是按步计，目标 20 轮以内，超过约 60 轮就停下重新规划）、动手顺序（短判断加一次廉价探测，提交型任务先交最小可行产物）、验证（验收一次通过即交付，不追加随机测试与压测）、工具与输出（用 read/glob/grep 读文件，批量调用，增量改写）、交付与范围（按用户语言作答，守住范围，不把密钥写进会话，同一路子失败两次就换）。

balance 只保留引擎替代不了的三条：守住语言与范围、不写密钥、连败两次就换路子并报告确切的命令和输出，适合需要模型发挥的特殊场景，如攻坚和oneshot。

> 说明：0.2.6–0.2.8 期间这两张卡曾叫「轻量PTC-v3 lite / balance」，0.2.9 起显示名回到「精简·PTC v3（lean-v3）」与「精简·PTC v3 balance」；**id 从头到尾没变**，旧会话无需重选。

## 实测

### 办公基准

两套虚构的日常办公数据处理任务：[办公基准 v1](https://github.com/LarryE135/dsh-flash-presets/tree/main/benchmarks/office/base-v1)（8 题）与[办公追加 v1](https://github.com/LarryE135/dsh-flash-presets/tree/main/benchmarks/office/addendum-v1)（5 题）。表中为每个配置的平均 token，含缓存读取，单位百万；OPS 指 [dsh-ops](https://github.com/T-Auto/dsh-ops)。

<!-- bench-table:begin（本块由 scripts/render-bench-table.mjs 生成，勿手改）-->
| 配置 | 办公基准 v1 | 相对标准模式 | 办公追加 v1 | 相对标准模式 |
|---|---:|---:|---:|---:|
| 标准模式 | 5.380 M（n=5） | — | 2.827 M（n=5） | — |
| PTC 模式 | 3.553 M（n=5） | −34.0% | 1.560 M（n=5） | −44.8% |
| lean-v3 | 1.437 M（n=5） | −73.3% | 0.481 M（n=5） | −83.0% |
<!-- bench-table:end -->

补充说明：

- `lean-v3` 是 0.2.5 时期的 13 条规则版，与 0.3.1 及以前的 `flash-lean-ptc-v3` 规则相同；0.3.2 起 v3 的规则 7 措辞调整（单调用也走一行 `run_code` 程序），其余 12 条不变。
- 「相对标准模式」同时包含了 PTC 工具面的收益。只看预设本身，应与 PTC 模式比：两个套件上分别约为 −59.6% 与 −69.2%（由表中数字算出）。
- 表里只有 token 消耗：逐题正确率没有留在本仓库（`docs/实测证据.md` 里另有一批 68.9167/100 的办公床记录，与上表不是同一批运行），所以不单列正确率。出题与评分使用同一个模型（`GPT-6.1-Sol`），答题与评分环节隔离以防止作弊。
- 评分规则公开在 [`benchmarks/office/grading/`](https://github.com/LarryE135/dsh-flash-presets/tree/main/benchmarks/office/grading)，真值与评分器放在私有仓库。

## 安装

### 用插件管理器（推荐）

插件管理器会装上整张插件卡：两个预设、计划模式组件、常驻 PTC 运行时，以及旧 id 兼容层。

```console
# npm 上按版本号装（锁死版本，别留 ^0.3 这类范围）
dsh plugin --profile web add dsh-flash-presets@0.3.2
# 不想走 npm 时，装同一个 tag
dsh plugin --profile web add github:LarryE135/dsh-flash-presets#v0.3.2
```

> 想跟仓库最新（含尚未发版的提交）就把 `#v0.3.2` 换成 `#main`。

`--profile` 通常取 `web` 或 `desktop`（`headless` 下预设不激活、`acp` 未验证，见[已知限制](#已知限制)）。在 GUI 的「插件 → 添加插件」里填包名或 GitHub 地址，效果相同。

预设直接决定 agent 的行为，需要可复现时请写死版本号。用 npm 包名且不带版本号时，管理器写入的是 caret 范围，之后任何一次 pnpm 操作都可能把它升到 0.3.x 的最新版；`github:` 安装写的是 git 引用（`#v<版本>`），不会自己漂移。

> 版本号怎么填：**正式版是 0.3.2**（`…@0.3.2` 或 `github:…#v0.3.2`）。上面示例钉的就是正式版 0.3.2。npm 上还有个仍可安装的**误发版 0.3.3**（已 `deprecate`，且比 0.3.2 少第四轮 6 项修复）—— 别装它。**写死版本号**：`^0.3` 这类范围会随 registry 漂移；pnpm 11 默认的 `minimumReleaseAge` 冷却还会让发布不足 24h 的版本装不到（裸装 / `@latest` 会静默退到上一版 0.3.1）。

### 离线或用脚本安装

从 [Release](https://github.com/LarryE135/dsh-flash-presets/releases) 下载附件解压，或克隆对应的 tag：

```bash
git clone --depth 1 -b v0.3.2 https://github.com/LarryE135/dsh-flash-presets.git
cd dsh-flash-presets
bash scripts/install.sh --profile web                  # Windows：scripts\install.ps1 -Profile web
```

脚本只向 profile 补丁写入一个托管块，里面是两个预设行；写入前会备份原文件，重复运行不会产生第二份。计划模式组件、旧 id 兼容层、组合自检与 `glob`/`grep` 并发标记属于插件本体，只有通过插件管理器安装才会加载。加 `--with-runtime`（旧名 `--with-plan-mode`；PowerShell 为 `-WithRuntime`）时，脚本会额外把 profile 级的 `ptc-runtime: persistent-in-memory` 写进该 profile —— 这一项对该 profile 的**所有**预设生效，`--uninstall` 会一并撤掉。

两条路径**二选一**：已经用脚本写过预设，要改装插件卡，请先 `--uninstall`。两条都装不会报错（`--dump-config` 仍退出 0），但选择器里每个预设会出现两张卡（实测补丁里 8 行预设）。`agent-preset/invalid` 是**预设定义解析失败**时的错误码，不是重复注册。


### 验证

```bash
dsh --profile web --dump-config | grep -c 'id: preset-'             # 6（内置 4 条 + 本包 2 条；未装其他预设包时）
dsh --profile web --dump-config | grep -c 'persistent-in-memory'    # 1
dsh --profile web --dump-config | grep -c 'plan-mode-ui'            # 1
node scripts/doctor.mjs --profile web                                # 版本、重复行、!!js、YAML 解析一次查完
```

这几条 `node scripts/...` 假设你在仓库（或解压后的 Release 附件）里。用插件管理器装的话，脚本在 profile 里：`node ~/.dsh/profiles/web/node_modules/dsh-flash-presets/scripts/doctor.mjs --profile web`。

### 更新与卸载

更新就是**重新执行同一条 `add`**，换上新版本号（或先 `remove` 再 `add`）。

> 用**精确版本**安装（`…@0.3.2`，不带 `^`）时，profile 的依赖会被钉死，之后 `dsh plugin update` **不会**自动升级；
> 升级只认「再 add 一次新版本」。另外 pnpm 会在 profile 的 `pnpm-workspace.yaml` 里留一行 `minimumReleaseAgeExclude`，
> 这是正常的（新发的包还没过冷却期）。

卸载：

```console
dsh plugin --profile web remove dsh-flash-presets     # 插件管理器安装的
bash scripts/install.sh --uninstall --profile web     # 脚本安装的（Windows：scripts\install.ps1 -Uninstall）
```

pnpm 会在该 profile 的 `pnpm-workspace.yaml` 里留下一行本包记录，`remove` 不会清掉它。这一行不影响配置合成。

### 从旧版本升级

- **预设 id 不再变动**：13 条规则版是 `flash-lean-ptc-v3`，3 条规则版是 `flash-lean-ptc-v3-balance`。0.2.7–0.2.8 曾把前者改成 `flash-lean-ptc-v3-lite`，0.2.9 起改回并不再改名 —— DSH 把 preset id 写进会话日志，改 id 等于让旧会话打不开。规则文本可以演进，标识符保持不变。
- 旧会话照常打开，而且**不被改写**：0.2.7–0.2.8 的 `flash-lean-ptc-v3-lite` 规则与 v3 完全相同，由运行时兼容层映射到 `flash-lean-ptc-v3`；更早的 `flash-lean`、`flash-lean-ptc` 也由兼容层解析。`flash-lean-ptc-v1` / `-v2` 也映射到 `flash-lean-ptc-v3`（0.2.8 时期就是这么映射的，0.2.9 不收回这条兼容）；它们的规则与 v3 不同，首次命中会在启动日志里打一条警告，要原规则的人在 profile 补丁里加自己的行 —— 本机就是这样保留 `v2` 的。自建 id 可用 `DSH_FLASH_PRESETS_ALIAS_EXTRA` 追加。兼容层只在解析失败时介入，也不改写任何会话文件。映射表见 [`presets/legacy-preset-map.json`](presets/legacy-preset-map.json)，原理见[预设 id 契约与升级](docs/预设-id-契约与升级.md)。
- **安装流程不碰会话**：`install.sh` / `install.ps1` 与插件启动都不扫描、不改写 `sessions/`。0.2.9 起**本包没有任何代码会写会话文件**（启动自愈 `lib/compat-heal.js` 已删除：它改 header 却不失效 DSH 的投影缓存，实际基本无效，还留下不释放的锁）。CI 里有断言：装一次、卸一次，`sessions/` 的校验和不变。
- **桌面端 / 插件卡**：旧会话能不能打开，全看组合包里有没有 `flash-presets-alias` 这一行（只 inject `agentPresets` 的独立插件）。0.2.9 之前的插件卡没有它，请重装：`dsh plugin --profile desktop add github:LarryE135/dsh-flash-presets#v0.3.2`。`node scripts/doctor.mjs --profile desktop` 会直接告诉你有没有。
- **脚本安装（`install.sh` / `install.ps1`）**：这条路没有别名层。如果升级前补丁里有 `flash-lean-ptc-v3-lite`，`merge-presets` 会额外保留一行兼容行（`order: 99`，标「勿选」），否则那些会话会 not-found。装过插件卡的 profile 会被脚本直接拒绝（`exit 4`），要叠加得显式 `--force`。
- **脚本路径升级会移除旧卡**：托管块是整块替换的，0.2.5 时代的三卡（`flash-lean-ptc-v1` / `-v2` / `-v3`）升级后只剩 `flash-lean-ptc-v3` 与 `-balance`。这条路径**没有旧 id 兜底**（别名层只随插件卡发行），引用 `-v1` / `-v2` 的旧会话升级后会 `agent-preset/not-found`。升级脚本会打印警告；需要旧会话继续可打开，请改装插件卡（`dsh plugin --profile <名称> add dsh-flash-presets`），它带兼容层。
- 装过独立包 `dsh-plan-mode-ui` 的，先 `dsh plugin remove dsh-plan-mode-ui`，否则计划模式会被注入两次。
- 如果 profile 的 `selectedDefault` 指向 `flash-lean-ptc-v3-lite`，建议改成 `flash-lean-ptc-v3`（留在旧值也能被兼容层解析）。

## 计划模式（可选组件）

同一张插件卡里还有计划模式组件 plan-mode v1（1.0.0）：同一个回合里先写计划，批准后再执行，结束时把实测的验收数字写回卡片。它与预设功能不同：预设插件通过规则调整预算，计划模式则提前规划本轮内容，确保模型不会因为约束过多或理解错误而执行。

- 入口在输入框左侧，档位为 off / light（原生计划模式） / full，与预设设置相互独立。
- 默认推荐 light。在 n = 3、7 项验收的对比中，两档都是 3/3 全过，full 的 token 多约 17%（中位 40.2 k vs 34.3 k）、耗时多约 33%（196 s vs 147 s，[变更日志](docs/CHANGELOG.md)）。
- 不用时在卡片里关掉这个组件即可，预设行为不受影响。
- **面板走本机回环**：`/api/plan-mode/*` 只接受 `Host` 为 `127.0.0.1` / `localhost` / `[::1]` 的请求（防 DNS rebinding）。用局域网 IP 或自定义主机名访问 Web GUI 时面板会被 403，界面会提示：设 `DSH_FLASH_PRESETS_TRUST_HOST=1` 后重启即放行。

## 交付门（可选组件，默认关闭）

同一张卡里还有交付门 `delivery-gate`。它不用规则文本，而是**在回合收尾时替你跑验收**：工作区里存在 `verify.sh` 就自动执行一次，通过才放行；不通过就把退出码和输出的最后一段回灌给模型，同一会话最多两次，让它在「不许交付」的前提下继续修。

- 为什么需要：P15654 的实测里，三份实现都在结束语里**如实**写了「17–19 超时 / 未覆盖」，然后照常交付 —— 缺的不是自述，是「不达标就不许结束」。
- 打开方式：把该行的 `enabled` 改成 `true`（`cordis.patch.yml` 末段的 `delivery-gate` 行），或临时设 `DSH_DELIVERY_GATE=1`；关掉用 `enabled: false` 或 `DSH_DELIVERY_GATE=0`。
- 脚本约定：默认按平台取候选（Windows 先 `verify.ps1`、其余先 `verify.sh`，可用 `scripts` 配置固定），超时按失败处理；它只读回退出码与输出尾部，不改你的文件。
- 注意：出厂配置把这行写成 `enabled: false`，插件 schema 的默认值也是**关**（0.3.1 是 `true`，0.3.2 改回 `false` —— 0.3.1 那一版会让普通对话也被验收门追着跑）。0.3.1 的代码只认 `DSH_DELIVERY_GATE=0`，设 `1` 打不开；从 0.3.2 起 `=1` 才真正生效。
- **版本提示**：交付门 0.3.0 里没有，**0.3.1 起随 npm 发布**（包内含 `lib/delivery-gate.js`，`cordis.patch.yml` 里也有这一行：`enabled: false` / `maxRounds: 2`，脚本按平台选 —— Windows 先 `verify.ps1`、其余先 `verify.sh`）。0.3.0 想用只能从 git 装（`dsh plugin --profile web add github:LarryE135/dsh-flash-presets#main`）；npm 上的 0.3.1、0.3.2（正式版）与 0.3.3（误发版）都带这一行，**不需要再等下一版**。

## 注意事项

- **先给目标和验收标准。** 标准越明确，效果越好；边界不清时配合 plan 或 goal 模式（P15654 的对照见[实测证据](docs/实测证据.md)）。
- **把输出上限调高。** 建议 120K 以上，条件允许就设到 384K，避免长时间推理被截断。
- **Windows 用户**建议先装好 PowerShell 7（MSI 版）或 Git Bash。
- **长思考模型一题一会话。** 一次塞多道题，模型可能把全部计划铺进同一个响应，在动手之前就被上游断流（[实测证据](docs/实测证据.md)「跨模型」）。

## 排查

先跑一次体检，再下判断：

```bash
node scripts/doctor.mjs --profile web          # 加 --dump 顺带跑 dsh --dump-config
node scripts/diag-preset-load.mjs --profile desktop   # GUI 里预设卡片显示「加载失败」时用
```

| 症状 | 原因 | 处理 |
|---|---|---|
| 预设卡片显示「加载失败」 | 预设里引用的插件在本机解析不到。最常见的是自行改预设时写了 `.../dsh-tool-subagent-control/list-agents`，该子路径在 DSH 0.2.2-rc.1 已移除 | 用 `diag-preset-load.mjs` 定位，删掉那一行 |
| 斜杠菜单里「压缩 / 计划 / 目标」消失，下一句报 `tool executor is unavailable` | 插件热重载后，已打开会话的预设组合被释放，没有自动重挂 | 重启 DSH。插件每 2 分钟自检一次并在日志里写明处置；设置 `DSH_FLASH_PRESETS_SELFCHECK_HEAL=1` 可自动重挂 |
| 预设列表里出现两三个同名项 | 旧安装方式留下的裸行与新托管块并存 | 重新运行安装脚本，它会认领并合并旧行 |
| `js-yaml` 报 `unknown tag` | 文件里还有 `!!js` 标签 | `node scripts/doctor.mjs --fix`（先备份） |
| 预设根本没出现 | DSH 低于 0.2.1-rc.5，或装错了 profile | 升级 DSH，或用 `--profile` 指对 |
| 升级 DSH 后预设突然消失 | DSH 已超出 `engines` 上限 `<0.2.3-0`，插件在加载时被跳过 | 升级本包；确需强行加载可用 `dsh plugin allow-version` 自担风险放行 |
| 工具凭空少了几个（例如 `glob` / `grep`），但没有任何报错 | profile 里某个 `@deepseek-ai/*` 副本与本机 dsh 版本对不上，dsh 挂载时**静默跳过**那一行 | `node scripts/doctor.mjs --profile <名字>` 第 9 项会列出来并给修法 |

预设补丁只定义 agent 侧的插件集合，不碰工作区选择器、目录选择器、终端这类 GUI 组件。如果装完后出现与预设无关的界面异常，请把 doctor 输出和浏览器控制台报错一起贴到 [issue](https://github.com/LarryE135/dsh-flash-presets/issues)。

## 与官方 PTC 预设的差异

| 官方有、本预设没有 | 影响 |
|---|---|
| `time-context` | 提示词里没有当前日期和时间，需要日期的任务请自己写明 |
| `tool-schedule` | 没有定时或周期任务工具 |
| `tool-plugin-market` | 不能在对话里装插件，请用 `dsh plugin` |

另外，预设声明了 `tool-subagent-codex`、`tool-subagent-claude-code`、`workflow-ptc`、`tool-workflow`、`tool-ralph` 和插件管理工具，但都处于禁用状态。需要这些能力时，用官方预设更省事。

## 已知限制

- 在 DSH 0.2.2-rc.1 的 headless profile 里，两个预设和计划模式都停在 pending，不会生效（每次运行会提示 `3 entries did not activate`）。请在 web 或 desktop profile 中使用。`acp` 完全没验证过。
- macOS 没有在真机上验证过。安装脚本按 bash 3.2 兼容写法编写，并在三平台 CI 上运行。
- 补丁含 `!!js` 标签，由 DSH 加载器解析，第三方 YAML 解析器会报 unknown tag。安装脚本在写入 profile 前会把它解析成普通值。
- `glob` / `grep` 的只读并发标记只在插件管理器安装时才有（`DSH_FLASH_PRESETS_CONCURRENCY=0` 可关）；脚本安装路径本来就没有它。旧 id 解析同理由插件提供（`DSH_FLASH_PRESETS_ALIAS=0` 可关）。
- 计划模式组件的两个开关也可以从环境变量给：`DSH_PLAN_TODO_SYNC=off|remind|strict`（默认 `remind`）控制是否提醒/强制写 todo，`DSH_PLAN_LAG_TURNS=<n>`（默认 2）是进度落后几回合才提示；等价于插件配置里的 `todoSync` / `lagTurns`。
- 计划模式的档位状态对其他监听 `planMode` 的插件是可见的。若同时装了会在计划模式下注入提醒的插件（例如 `chatgpt-subscription`），纯问答（只说话、不调工具）的回合可能被判成「没做完」而**再答一遍**。缓解：这类会话把计划模式档位切到 `off`。
- 开发与测试主要围绕洛谷公开题库和上面的办公基准，其他类型任务的表现缺少数据。

## 开发与校验

```console
npm run verify          # 合成一致性、YAML、预设结构、文本审计、版本一致性、基准防泄漏等
npm run bench:office    # 办公基准的结构与完整性校验（只在仓库里可用，npm 包不含 benchmarks/）
bash scripts/selftest.sh
node scripts/verify-session-compat.mjs   # 升级后旧会话还能不能打开（10 类合成会话，含两个反向控制）
```

> 这三条都要求**完整克隆**（`git clone` 下来的仓库）。npm 发行包只带运行需要的那部分脚本与两份预设：
> `scripts/` 里有一部分文件、`benchmarks/`、`tools/`、插件源码与测试都不随包，所以包内
> `npm run verify`、`prepublishOnly`、`bench:*` 等 script 会因缺文件失败（仓库 `scripts/` 下有 44 个
> 文件，发行包只带其中一部分）—— 那是发行包本来就不含开发面，不是坏了。要在装好的包旁边跑这些，请另克隆仓库。

`cordis.patch.yml` 由 `presets/*.patch.yml` 合成，请勿手改，CI 会断言两者一致。README 里的实测表由 `docs/bench-office-results.json` 生成。贡献方式见 [CONTRIBUTING](https://github.com/LarryE135/dsh-flash-presets/blob/main/CONTRIBUTING.md)。

## 版本历史

### v0.3.2（2026-11-17，当前正式版）

发布：npm 上的 0.3.2（`…@0.3.2` —— 以 `npm view dsh-flash-presets version` 为准，`latest` 指向它）、GitHub Release `v0.3.2`、tag `v0.3.2`（= `ea8c3d8`）。上一版正式版是 0.3.1。

- **自动批准按钮换 v1.1 字形**：两段环箭头 + 中心对勾，`off / on / fire` 三态生效（每真正自动批准一次，外圈甩半圈、对勾弹一下），20px；修掉旧 `.pmo-aa svg` 规则强制 15px 与「按钮里所有 svg 一起旋转」——那正是对勾跟着外圈转、图标始终长不大的原因。
- **默认上下文瘦身**：`tool-skill.catalogDescriptionMaxLength: 60`，关闭 `session-log-deepseek` / `plugin-package-inventory-deepseek`（两份上报合计每请求少传约 40 KB，不进上下文）。
- **交付门回归默认关闭**：`delivery-gate.enabled` 默认 `true` → `false`，普通对话不再被验收门追着跑。
- **计划模式**：「空跑一场」不再被当成批准；作用域默认 `always` → `auto`。

**第三轮自查（P0 1 / P1 3 / P2 10 / P3 12）的整改**，逐条见 [审计-第三轮-自查](https://github.com/LarryE135/dsh-flash-presets/blob/main/docs/审计-第三轮-自查-20261117.md)：

- **安装器不再删掉你改过的预设行**：`merge-presets` 以前只比结构（包装行 + `config.id`）就把托管块外的同 id 条目当残留删掉，还打印「内容与安装器写入的一致」；现在逐行比对——改过的那条原样保留，也不再另写一份我们自己的（同 id 只留你的）。
- **full 档「批准后转执行」在 rc.3 上投递不到**：`agent.steer()` 放在 `session/event` 监听器里同步调用，会撞宿主的 append 重入守卫，异常被 `catch` 吞成一条日志；改为宏任务投递，「规划期动手」的中途纠偏同样处理。
- **PTC 模式下「规划期先动手」检测失效**：嵌套调用不发 `tool/call`，只发 `tool/ptc-dispatch(-start)`；插件补上这两个分支，并加了回归测试。
- **两处服务访问静默失效**：`ctx.webServer` / `ctx.sessionProjections` 未 inject 时直接取会抛，兜底永远轮不到 —— 改走 `ctx.get`（core 状态路由、内置 `/plan` 让位闸）。
- **发版脚本 fail-closed**：`publish.sh` 的 CI 闸门不再「查不到就跳过」（无 gh / 未登录 / run 未完成 / 列表为空一律拒发，`ALLOW_UNKNOWN_CI=1` 才放行）；`DRY_RUN` 挪到远端 tag 守卫之后；`verify-versions` 不再被 `dist/` 里的旧 zip 卡死。
- **交付门按平台选脚本**：出厂补丁不再钉死 `verify.sh`，Windows 上默认 `verify.ps1`。
- **文档口径**：撤掉「300k 以上」的过期读数与「0.25 每次都真压缩」，修正 54 项自测 / 30 个插件测试文件 / 插件 1.0.0、`align-presets.sh` 指向不存在的脚本、v1/v2 别名、README 缺失的排障日志块；评审守卫正则不再误拦「只取值 / 注释 / 字符串」里出现的工具名。

**第四轮审计的整改（本轮）**：

- **计划模式下同步 steer 撞 append 重入守卫**：在 `session/event` 里同步调 `agent.steer()` 会抛——改成宏任务投递。
- **PTC 预设下 `run_code` 内部的工具调用不发 `tool/call`**：改用 `tool/ptc-dispatch-start` 与 `tool/ptc-dispatch`，纠偏与「已在执行」判定与 `tool/call` 同语义。
- **评审超时守卫（`tools.guard`）**：不再把「注释 / 字符串里写了调用形态」当真调用；同时补上 `tools["<名字>"]?.()`、模板键、`.call(` 等真调用形态。
- **`scripts/merge-presets.mjs` 认领历史残留**：按缩进算条目边界（以前按第一个空行 → 199 行条目只读到 13 行、被判成安装器写的、删头留尾写坏 YAML）；`- insert:` 数组改成逐条摘（别人的条目与数组内注释都保住）；卸载路径加「顶层必须是块状数组」结构闸；全部条目都被用户改过时不再写空托管块。
- **新增 `scripts/test-merge-presets.mjs`**（24 条断言，第五轮扩到 32 条）并接进 `scripts/selftest.sh`（自测 54 项）。

### v0.3.3（2026-11-17，误发版本：npm 上仍有、已 deprecate）

> **这一版是版本号写错的产物**：原计划按 0.3.2 发布，`package.json` 被写成 0.3.3 且已 `npm publish`。处置：**0.3.2 追认为正式版**（npm `latest` 指向它），0.3.3 标为误发并在 npm 上 `deprecate`（仍可安装，但不是正式版）。
> **包内容与 0.3.2 不同**：0.3.3 是第三轮整改的提交（`54fc895`）打的包；0.3.2 在其上又并入了第四轮 6 项修复（计划模式宏任务投递、PTC 事件语义、评审守卫注释/字符串遮罩、PHASE 2 记账回滚、`merge-presets` 认领边界、卸载结构闸）。两个包有 11 个文件不同（`lib/index.js`、`scripts/merge-presets.mjs`、两个安装器、若干文档），复核：`git diff --stat v0.3.2 v0.3.3`。
> 误发当时的横幅原文是「当前版本：v0.3.3（tag `v0.3.3` 已打，npm 0.3.3 + GitHub Release 同日发布）」，已按 0.3.2 口径改写。
> **装包请写死版本号**：范围会随 registry 漂移；pnpm 11 默认冷却期（`minimumReleaseAge`）里，刚发布的版本裸装 / `@latest` 会退到上一版。

### v0.3.1（2026-11-12，上一版正式版）

- **`run_code` 优化随安装即生效**：`glob` / `grep` 只读并发安全优化从 `plan-mode-ui` 独立成 `flash-presets-core` 一行，
  只 `inject` `tools` / `agents`。此前关掉计划模式、或用只挂部分行的组合，优化会静默消失；headless 下更因 `plan-mode-ui`
  停在 `pending` 而完全跑不到。关闭：`DSH_FLASH_PRESETS_CONCURRENCY=0` ＞ 行内 `toolConcurrency.enabled=false` ＞ 默认开启。
- **修复子代理「选模型 / 列模型」在 DSH 0.2.2 上一直是关的**（#21）：两份预设补 `modelSelection` / `modelDiscovery`，
  删掉 4 处没有任何代码读的 `backgroundMode`。
- **新增交付门 `delivery-gate`**（schema 默认 `true`，与当时文档写的「默认关闭」相反；0.3.2 已改回 `false`）与 `doctor` 第 9 项（profile 里会被静默禁用的插件）。
- 旧会话兼容：新增 `verify-session-compat.mjs` 守卫（A5）；`doctor` / `audit-compat` 的空环境误报全修（A3）；
  别名行与两份预设行不许 `disabled`（A8）。
- **预设 id、规则文本、压缩阈值与裁剪参数均未改动**，装法不变（插件卡 / bundle / 脚本三条路照旧）。

### v0.3.0（2026-11-07）

- 之后在 `main` 上陆续修正 CI 与随包文档（**不升版号、不发 Release**）：`verify` job 改跑 `npm run verify`、新增「文档陈述对账」lint、修 `tune-runtime --check` 与 `install.ps1` 的 `DSH_HOME` 泄漏、`publish.sh` 每次重打附件。预设 id / 规则 / 行为一律未变。

- **只改显示名与描述，id、规则、行为都不动**：`flash-lean-ptc-v3` 描述改成「效率最高的版本，适合绝大多数日常工作。」；
  `flash-lean-ptc-v3-balance` 显示名改成「精简·PTC v3 balance」，描述去掉内部约定。DSH 只认 `config.id`，`config.name` 只是 picker 里的文字，
  所以旧会话、旧 id 一律照旧解析。
- 顺手修掉 0.2.9 的两处记录错误（`publishedVersion` 仍是 0.2.8；随包文档写着「npm 待发」）。

### v0.2.9（2026-11-07）

- **把预设 id 改回稳定值**：lite 的 id 从 `flash-lean-ptc-v3-lite` 回归 `flash-lean-ptc-v3`（0.2.5 及更早发布时的身份），以后不再改名。0.2.7 那次改名让桌面端装上新版后，会话日志里记着 `flash-lean-ptc-v3` 的旧会话直接打不开；兼容层只能在解析这一步兜底，兜不住别处的校验，所以改为从根上不动标识符，只演进规则文本与描述。
- 兼容层继续保留，方向反过来：0.2.7–0.2.8 产生的 `flash-lean-ptc-v3-lite` 与更早的 `flash-lean`、`flash-lean-ptc`、`-v1`、`-v2` 都解析到 `flash-lean-ptc-v3`。
- 没装 `--with-runtime` 的用户无需任何迁移：装上新版即可打开全部旧会话。

### v0.2.8（2026-11-06）

- 第三轮审计修正：修掉「`--with-runtime` 装过再 `--uninstall` 会把补丁写成空文件、profile 起不来」这个回归（卸载顺序改成先撤运行时块，撤块时补回 `[]`）；Windows 的 `-Uninstall` 也会撤运行时覆盖。
- `tune-runtime` 不再静默忽略不认识的参数（`-Profile` 曾让它把覆盖写到所有 profile）；`doctor` 的第 3 节只判定现役两个预设、第 6 节不再建议装裸包名、发现问题时退出码 1；`install.sh --help` 不再截断末句。
- `publish.sh` / `publish.ps1` 删掉移动 tag 的逃生阀（查不到远端就拒绝执行，附件改为按 tag 打包）；`verify-versions` 开始检查安装器、marketplace 与两份 README 里写死的版本。
- npm 跳过 0.2.7 直接发 0.2.8：0.2.7 只存在于 GitHub tag `v0.2.7`。

### v0.2.7（2026-11-06）

- 第二轮审计修正：安装器文案与 `--with-runtime` 更名、`--uninstall` 撤掉运行时覆盖、`doctor --sessions` 不再崩溃、alias 表移除 `$comment`、peer 范围补上 0.2.2-rc.1、`NOTICE` 附上游 MIT 全文。
- 文档口径与实现对齐：README 顶部如实写出对整个 profile 生效的两项与关闭开关；「12 个历史 id」改为 5 个；修掉失效锚点与悬空引用；计划模式「贵 26%」按中位数订正为 17%。
- CI 加了 `0.2.2-rc.1` 的安装矩阵与「打包→解包→跑用户侧脚本」的 job，`bundle-install` 的断言从子串匹配改为精确 id。
### v0.2.6（2026-11-06）

- 预设收敛为两个：lite（13 条，默认）与 balance（3 条）；v1、v2 与实验变体移出发布包。
- 计划模式并回主包（plan-mode v1），与两个预设同在一张插件卡里。
- 新增运行时兼容层：5 个本包发布过的历史 preset id 解析到 lite，不改写会话文件。
- 新增组合自检、四层对齐审计（`npm run audit:align`）与 `glob` / `grep` 只读并发标记。
- 修复：DSH 0.2.2-rc.1 移除 `list-agents` 子路径后，预设卡片显示「加载失败」。

更早的版本：0.2.5 起默认只装 v3；0.2.2 起可从 npm 安装；0.2.1 起 v3 成为主版本；0.2.0 起以组合包形式交付；0.1.0 为首个发布。逐项明细见[变更日志](docs/CHANGELOG.md)与 [Releases](https://github.com/LarryE135/dsh-flash-presets/releases)。

## 文档

- [实测证据](docs/实测证据.md)：全部实验数据，包括没有成立的结论
- [版本与兼容性](docs/版本与兼容性.md)：版本对应表与安装回归
- [预设 id 契约与升级](docs/预设-id-契约与升级.md)
- [技术文档 · 省 token 的四套机制](docs/技术文档-省token四机制.md)、[技术文档 · 实现方式与路径](docs/技术文档-精简预设实现.md)
- [变更日志](docs/CHANGELOG.md)

## 许可证

[MIT](LICENSE)

## 维护者

<table>
  <tbody>
    <tr>
      <td align="center" width="150"><a href="https://github.com/LarryE135"><img src="https://github.com/LarryE135.png?size=160" width="96" height="96" alt="LarryE135"></a><br><a href="https://github.com/LarryE135"><b>LarryE135</b></a></td>
    </tr>
  </tbody>
</table>
