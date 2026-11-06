# 预设 id 是持久化契约：升级策略与排障手册

> 这份文档回答一个问题：**为什么改一个 preset 的名字/id 会把用户的旧会话“弄丢”，以及正确的升级姿势是什么。**
> 结论来自 DSH 0.2.2-rc.1 的实际实现（`/usr/lib/node_modules/@deepseek-ai/dsh/`），不是推测。

## 1. DSH 到底怎么判定“这条会话用哪个预设”

preset id 在两处被持久化：

1. 会话日志首帧：`header.agentPreset`（创建时写入）；
2. 事件流：每条 `agent-preset/selected`（用户在 UI 里切过预设时追加）。

运行时读的是**投影**，规则极其简单（`dsh-agent-preset-registry/lib/index.js:47-58`）：

```js
const agentPresetProjectionDefinition = {
  key: 'agentPreset',
  init: (header) => header.agentPreset ?? null,      // 初值来自 header
  apply: (state, event) => event.type === 'agent-preset/selected' ? event.data.agentPreset : state,
};
```

也就是 **有效 preset = 日志里最后一条 `agent-preset/selected` 的值，一条都没有才是 header**。

打开/继续会话时（`dsh-api-session-controller`）：`resumeObserved()` → `composeAgent(presetForObservation(...))` → `agentPresets.resolve(id)` → 找不到就 `throw new RemoteError('agent-preset/not-found')`。**没有任何兜底**。

唯一的宽容点只有一处：`restoreBlank()`（`dsh-client-ui-workspace/lib/client.js:1454-1471`）在**重开空白会话**时遇到 `agent-preset/not-found` 会退回 Host 默认预设。已经聊过的会话不走这条路径。

## 2. 上游为什么“没法”平滑改名

| 你可能期待的机制 | 上游现状 |
|---|---|
| definition 上写 `aliases` / `aliasOf` | 不存在。definition 只有 `id / name / description / order / plugins` |
| 从 picker 里隐藏旧卡 | 做不到。picker 只过滤 `broken`（`dsh-client-ui-agent-preset/lib/client.js:1753`），而 `broken` 的定义是“这份定义挂载失败”，用它隐藏会连解析一起废掉 |
| 缺 id 时退回默认预设 | 仅 `restoreBlank` 一处；`resolve`/`retain` 一律抛错 |
| 官方提供会话 id 迁移工具 | 没有。只有格式代际迁移（v0→v4，`sessionFormatCatalog`），不含 preset id |

所以上游的隐含契约是：**preset id 一旦写进用户数据，就必须永久可解析**。这也解释了内置预设的行为——`standard` / `ptc` / `minimal` / `cordis` 这几个 id 多年不变，变的只是内容。

## 3. 我们踩过的三个坑（都在这条契约上）

| 版本 | 动作 | 后果 |
|---|---|---|
| 0.2.6 | 删掉 `flash-lean-ptc-v3` 等旧 id；`migrate-legacy-preset-ids.mjs` 用 `zstdDecompressSync` 整文件重写 | 多帧 zstd 只解出首帧 → 事件帧全丢；WSL 194 / Windows 273 个会话被截断 |
| 0.2.8 | 启动时“自愈”改写 header | 只改 header 不改 `agent-preset/selected`，而且没清投影缓存 → 一部分会话仍旧 not-found（看起来“修了但没生效”） |
| 0.2.9 | ①把 lite 的 id 从 `flash-lean-ptc-v3-lite` **改回** `flash-lean-ptc-v3` 并冻结；②把 `flash-lean-ptc-v1` / `-v2` 按 0.2.5 原文注册成兼容卡 | 修好上一行：281 个桌面端会话重新落进 roster，不再依赖兼容层；v1/v2 的会话解析到**自己的**规则，不会被映射成 v3 的行为。本机 1007 个桌面端会话：`defined` 502、`aliased` 0、`orphan` 3（全是私有 id） |

另外两个隐藏前提，出事时会让局面更难判断：

- **首帧必须只有一行 header**，且**文件名里的代际必须等于 header 的 `version`**。否则 `readGenerationHeader()` 抛 `session generation filename identifies v4, but its header identifies v3`，整个 workspace 行激活失败 → GUI 里看起来“所有会话都没了”。
- **投影缓存按 `seq` 续算**（`storages/session_projcache/`）。改写比缓存更早的事件而保留缓存，旧值会被继续沿用。

## 4. 正确的升级姿势（本包 0.2.9 起真正执行）

1. **id 冻结**：任何发布过的 id 不再删除、不再改名。要改行为就改内容、改显示名、改 `description`。现役两个 id 是 `flash-lean-ptc-v3`（13 条，默认）与 `flash-lean-ptc-v3-balance`（3 条）；0.2.7–0.2.8 期间的 `flash-lean-ptc-v3-lite` 是**一次违背本条的改名**，0.2.9 已改回，代价是那两版产生的会话要靠 alias 层兜底。
1b. **规则不同的历史 id 不许映射、也不强行随包发行**：`flash-lean-ptc-v1` / `-v2` 的规则与 v3 不同（14 条 / 0.3·50k、12 条 / 0.25·20k），映射过去等于让那时创建的会话静默换规则。0.2.9 的最终口径是：发行包只发 `flash-lean-ptc-v3` 与 `flash-lean-ptc-v3-balance`，v1/v2 在 `presets/compat-exceptions.json` 里登记 reason + fallback（`check-preset-compat` 强制要求），谁需要谁在自己的 profile 补丁里加行（源文件见 tag `v0.2.5`，唯一改动是删掉上游已移除的 `list-agents` 子路径）。把它们映射到 v3 会让那些会话的行为被悄悄改掉——那不是兼容，是改写。规则相同的 id（`-lite` 与 v3）才可以用别名，也不占卡片。
2. **alias 层兜底**（`lib/preset-alias.js` + `presets/legacy-preset-map.json`）：历史 id 在解析时映射到当前 id。只拦 not-found，纯内存，不写用户数据，不加 picker 卡片，卸载即还原。
3. **审计按 DSH 语义**（`npm run audit:sessions`）：有效 preset = header + 最后一条 selection；roster 取 `dsh --profile web --dump-config`。发现孤儿 id 就 `exit 1`。
4. **CI 闸门**（`npm run verify:compat`，已进 `npm run verify`）：历史 tag 里的每个 id 必须“仍定义 / 在 alias 表 / 登记例外”三选一；alias 表的 canonical 必须是真实定义过的 id。
5. **可选的一次性迁移**（`npm run retarget:sessions`，默认 dry-run）：想把兼容层彻底清掉时用。**这两个脚本只在仓库里，不随 npm 包发布**（它们会改写会话文件，属于维护者工具）。约束见脚本头注释：只改决定解析结果的那一处、帧级改写、整份备份、写前写后双校验、清投影缓存、可回滚、幂等。

## 4.1 已知限制（复查时确认、暂不修）

1. **alias 层跟着 `plan-mode-ui` 这一行加载**，而该行的 `inject` 里有 `webServer`。桌面端（Electron）不走 web profile，这一行很可能停在 pending、alias 根本没装上 —— 所以**不要把兼容层当成「旧会话一定能开」的保证**；真正兜底的是 id 不再改名。所以它只在**装了本组合包、且该 profile 有 webServer（web）** 时生效；把本包装进 `tui` / `headless` 一类 profile 时，这一行会停在 pending，alias 也不会挂上。要覆盖那种场景，需要把 alias 拆成一个只 `inject: ['agentPresets']` 的独立 loader 行（改动面更大，暂不做，已在待办里）。
2. **alias 是运行时的、不是永久的**：会话日志里仍然写着旧 id。若以后彻底清理（`retarget:sessions`），日志才真正改成新 id；在那之前删掉 alias 表等于让这些会话再次打不开。
3. **注册表实例重建时包装会失效**（profile 热重载插件的场景）。进程重启会重新挂上；同一进程内重建不会。审计脚本随时可查（`orphan=0` 才健康）。
## 5. 升级后的自查流程

```bash
npm run audit:sessions                 # 本机 ~/.dsh
node scripts/audit-compat.mjs --dsh-home /mnt/c/Users/<you>/.dsh   # Windows 侧
```

输出三段：分布（none / defined / aliased / orphan）、`header≠有效 preset` 的条数、孤儿 id 及其最大的几条会话（含项目目录、日期、首句）。`orphan = 0` 才算健康。

## 6. 排查清单：会话“打不开/变空”时按顺序查

1. `node scripts/audit-compat.mjs` → 有孤儿 id？→ 加进 alias 表（不动数据）。
2. 日志里 `session generation filename identifies vN, but its header identifies vM`？→ 文件被外部改写坏了，需要按代际重写或从备份恢复。
3. 首帧不是一行 header（`first-frame-has-N-lines`）？→ 被不正确的迁移脚本写过，见 docs/CHANGELOG 0.2.6 事故记录。
4. 侧栏看不到但文件在？→ `~/.dsh/storages/workspace.json` 的 `global.archivedSessionIds`（归档 ≠ 丢失）。
5. 以上都正常 → 看 `~/.dsh/logs/`、`journalctl -u dsh-web`，以及 `agentPresets/list` 里该预设是否 `broken`（插件行引用了上游已移除的子路径就会这样）。
## 7. “看起来没对齐”怎么查：四层与 `audit-align`

`audit-compat` 回答的是“能不能打开”。它会因为 `none` 桶而误导——`none`（没有记录 preset）的会话绝大多数是**自动化/实验跑批**留下的（本机私有的试验目录与 `/tmp` 一类临时目录，不随包发布），它们的组合由调用方的 profile 决定，**不受 web profile 的 `selectedDefault` 支配**；改默认值只影响新建会话，不能用来“修”这些老会话。

“看起来没对齐”要按四层分开看（`npm run audit:align`，即 `scripts/audit-align.mjs`）：

| 层 | 判据 | 坏了会怎样 | 修法 |
|---|---|---|---|
| ① 存储 | 同一会话目录只认世代号最大的日志；`header.version` ⇄ 世代文件名 ⇄ `encodeSegment(id)`/`projectKey(cwd)` 路径 | 上游 `listArtifacts` 对**任一**目录抛错会中断整张列表 → 侧栏空/会话打不开 | 按代际重写或从备份恢复；`audit-align` 会点名 |
| ② 解析 | 有效 preset ∈ roster ∪ alias 表 | resume 抛 `agent-preset/not-found` | 加 alias（不改数据） |
| ③ 记录 | 记录的是否还是历史 id | 解析没问题，但头部标签按 roster 查名字，查不到就显示原始 id（`flash-lean-ptc` 这类） | 一般无需处理（alias 只管解析、标题显示原始 id 是预期）；要彻底改写用仓库内的 `retarget-session-presets --apply`（不随包发布，需停服务） |
| ④ 组合 | 挂载后 `commands.list` 里有 `compact`、`tools.selectExecutor` 不抛 | 斜杠菜单缺「压缩/计划/目标」，下一句报 `tool executor is unavailable` | 重启 dsh；`composition-check` 每 2 分钟自检 |

本机 2026-11-06 的基线（1622 个会话）：① 1622/1622 通过；② orphan 0（162 条走 alias）；③ 162 条仍写历史 id（48 条在侧栏）；④ 0 条失效。另：274 份历史世代日志（182.6 MB）按选取规则被忽略，属正常残留。

一条命令做完 ③ 的对齐（含装包与复审）：

```bash
bash ~/.dsh/scripts/align-presets.sh            # 演练
bash ~/.dsh/scripts/align-presets.sh --apply    # 停服务 → 改写 → 摘冒烟会话 → 装包 → 起服务 → 复审
```

