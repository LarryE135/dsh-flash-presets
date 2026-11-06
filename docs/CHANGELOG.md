# 变更日志

> **版本口径（2026-11-06 发布整理）**：对外只发 **0.2.6**（npm 上接在 0.2.5 之后）。当天为定位问题临时引入的
> 迭代号 0.2.7–0.2.14 从未发布，全部并入 0.2.6；下面把它们降为三级标题保留，便于追溯与回滚定位。

## 0.2.6（2026-11-06，发布）

- **发布前修正：DSH 0.2.2-rc.1 下两张「Agent 预设」卡片显示「加载失败」**（本机实机复现并修复）
  - 现象：GUI「设置 → Agent 预设」里 `轻量PTC-v3 lite` 与 `轻量PTC-v3 balance` 都带红标「加载失败」；`agentPresets/list` 的 `broken` 为 `tool-subagent-list-agents (@deepseek-ai/dsh-tool-subagent-control/list-agents): never started`，新建会话用不了这两个预设。
  - 原因：两个预设都声明了 `- id: tool-subagent-list-agents` / `name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'`。DSH 0.2.2-rc.1 把 `list_agents` 并进 `@deepseek-ai/dsh-tool-subagent-control` 主插件，`exports` 只剩 `"."`，子路径 `./list-agents` 已不存在；该行 import 失败，**整份预设**被判 broken。0.2.1-rc.x 上这行有效，所以在旧版本上测不出来。
  - 修法：两份 `presets/*.patch.yml` 删掉这个两行条目（`list_agents` 由 `tool-subagent-control` 主插件自带，能力不减），重新合成 `cordis.patch.yml`；`verify-yaml.mjs` 增加断言，禁止再出现该子路径。
  - 验证：`desktop` profile 实机安装后，用一次性诊断插件调 `agentPresets.list()`，两个预设均无 `broken`；`--dump-config` 本包预设行 2 条、`persistent-in-memory` 1 处、`plan-mode-ui` 1 处。
- **升级注意（0.2.5 → 0.2.6）**
  - `flash-lean-ptc-v3` 这个 id 不再存在：按 id 恢复的历史会话会找不到预设，需要在「Agent 预设」里重选；`agent-preset-registry` 的 `selectedDefault` 若仍指向旧 id，新建会话报 `Unknown agent preset: flash-lean-ptc-v3`。
  - `flash-lean-ptc-v3-lite` 的语义变了：0.2.5 时期它是 3 条规则的弱约束版，0.2.6 起是 13 条规则的默认版；原来的 3 条版本改名为 `flash-lean-ptc-v3-balance`（order 26）。
  - `desktop` / `headless` / `acp` 只在启动时读补丁层，装完必须完全退出再启动；`web` 刷新页面即可。替换后卡片仍然红，说明还有别的行不匹配，按上面 `broken` 字符串的格式继续排查。
  - 自定义预设时不要写 `@deepseek-ai/dsh-tool-subagent-control/list-agents`：DSH 0.2.2 起该子路径已移除，写了会让整份预设失效。

- **预设重命名为两个，语义按「约束强度」重新排列**：
  - `flash-lean-ptc-v3-lite`（显示名「轻量PTC-v3 lite」，13 条规则，order 27，**默认**）：原 `flash-lean-ptc-v3` 的自由精确改名，描述改为「效率最高的轻量预设，适用于绝大部分日常工作」。
  - `flash-lean-ptc-v3-balance`（显示名「轻量PTC-v3 balance」，3 条规则，order 26）：原 `flash-lean-ptc-v3-lite` 改名，描述改为「约束较弱的预设，适用于需要模型发挥的场景」。
  - `flash-lean-ptc-v3` 这个 id 不再存在；按 id 恢复的历史会话会找不到同名预设，需在选择器里重选。
  - `v3-max`（7 条）与 `v3-none`（0 条）仍在 `presets/` 之外，只保留在评测协议 `arm-v3max.yml` / `arm-v0.yml` 里作对照臂。
- 依据：三床 × 四臂实测（决策 15 次/臂、hard 9 次/臂、算法 10 次/臂）显示 persona 规则条数对质量与 token 均无可测差异（配对比 0.86–1.42，Bonferroni 后无一显著）；同时长任务注意力评测里 v3 在长文阅读轴出现可判定退化（−4.00 [−7.60, −1.20]），故不做进一步削减，也不保留无人格对照组作为发布项。
- 校验脚本、安装器、doctor、README 与版本表同步改为两预设口径（`verify-runtime` 断言预设行数为 2）。

### 同日迭代（0.2.7–0.2.14，未发布，已并入 0.2.6）

### 0.2.14（2026-11-06，A 的实测验收：发现「第一轮赶不上扫描」的竞态，改成决策点即时标记）

- **现场实测（真跑）**：在 GUI 里新建会话、同一轮发 3 个 grep（`path` 都是本仓库，`pattern` 分别是 `preset-alias`/`composition-check`/`tool-concurrency`），从会话日志取 `tool/call → tool/result` 时间窗：
  `18:53:17.880→.920 / .920→.942 / .943→.962` —— **首尾相接，串行 82ms**，不是并行。
- **根因是竞态，不是标记无效**：该会话 18:53:12.790 才 `agent-preset/selected`，18:53:16.044 开轮，18:53:17.88 三个调用就发完了；而 0.2.13 的补标记**只有 15s 定时扫描一条路径**，最近一次扫描发生在会话挂载之前 → 那一轮里 `glob`/`grep` 还是「没声明」的原始定义，`executionMode()` 按 exclusive 串行。换句话说：**A 只对「挂载超过 15s 之后」的轮次生效**，而人打开会话后通常几秒内就发第一句。
- **修法一（决定性）：在决策点挂钩**。pipeline 取工具定义走 `ctx.tools.executable(name, scope, toolSet)`（`pipeline.js:261`，`this.tools = ctx.tools`，原生执行器不带 `source.get`），于是包住 `executable()`，目标名（默认 `glob`/`grep`）返回前若还没标记就补上——调度器问「能不能并行」时一定已经带上标记，与定时扫描无关。只标记未声明的（上游自己声明则原样保留），异常全部吞掉，卸载时还原 `executable` 并撤掉「顺手」打上的标记（`Symbol.for("dsh-flash-presets.tool-concurrency.hook")` 防重复安装）。
- **修法二（兜底）：扫描间隔 15s → 500ms**（`toolConcurrency.sweepMs` 可调），并订阅 `agent/created`，新会话挂载时立刻标一次。
- **日志改成「按作用域增长各打一条」**（以前只打首次）：每多标住一个会话就多一行 `已标记 glob,grep（全局视图 + N 个会话作用域，共 M 处）｜调度器判据 glob=true grep=true`，方便事后核对「标记是否先于那一轮」。幂等，不刷屏。
- **测试** 12 项（新增 2 项）：`executable` 钩子在**决策点**即时标记（扫描间隔故意设成 10 分钟，证明不依赖扫描）、非目标工具不受影响、卸载还原；日志随作用域增长（+1 会话 → 多一条且显示 `+ 2 个会话作用域`）。
- **顺带修正 0.2.13 的文档口径**：0.2.13 条目里「按 500ms/1s/2s 退避重试（默认 4 次）」与 `toolConcurrency.attempts` 是早期设计的残留，实际发布的是「全局 + 按 agent 作用域扫描」这一版，本次一并改正。
- **验收方法**（重启后）：新开会话发同一轮 3 个 grep，然后 `node ~/.dsh/scripts/measure-tool-concurrency.mjs --session <id片段> --name grep`，应显示 `批 [3] … ⇒ 并行`（跨度 < 各自耗时之和）；对照组把 `DSH_FLASH_PRESETS_CONCURRENCY=0` 打开重启，同样跑一次应显示 `⇒ 串行`。

### 0.2.13（2026-11-06，run_code 优化 A 真正落地：不再改 node_modules，改由插件在运行期给 glob/grep 补并发标记）

- **背景（实测）**：在隔离环境做全新安装验证时发现，A（@「原生多调用 492→204 ms」）**一直是空操作**：`scripts/tune-runtime.mjs` 要改的 `profiles/<p>/node_modules/@deepseek-ai/dsh-tool-fs-search/lib/index.js` 在 0.2.2-rc.1 的布局里根本不存在（该包不是 profile 依赖，从全局 dsh 安装解析），脚本自己报 `A 只读并发 = n/a`；上游 `dsh-tool-fs-search` 至今 **0 个** `isConcurrencySafe`（`glob`/`grep` 都没声明），而 `dsh-tools/lib/pipeline.js` 的 `executionMode()` 只认 `=== true`，于是多调用一律串行。B（常驻 PTC 运行时）不受影响，全新安装即生效（dump 里 `persistent-in-memory` 恰好 1 处）。
- **新做法 `lib/tool-concurrency.js`**：`tools.register()` 不允许同名覆盖（`tool "glob" is already registered`），所以在**已注册的定义对象**上补一个分类函数——`defineTool` 返回的是普通可变对象，registry 与调度器持有同一引用，补完 `executionMode()` 立刻返回 `{kind:"parallel"}`。不碰 `node_modules`、不改 profile 配置、插件卸载时用 `ctx.effect` 撤掉标记。
- **行为细节**：只标记「未声明」的工具（上游将来自己声明了就原样保留，不覆盖）；预设组合是**按 agent 挂载**的，所以扫「全局视图 + 每个已挂载 agent 的作用域」（`tools.get(name, agent)`），定时补新会话（0.2.13 是 15s；0.2.14 起 500ms + 决策点钩子）；`DSH_FLASH_PRESETS_CONCURRENCY=0` 关闭，cordis 配置 `toolConcurrency: {enabled, tools, sweepMs}`；启动日志会打出调度器判据，重启后 grep 一行即可确认。
- **`scripts/tune-runtime.mjs` 的 A 段退化为状态检查**：不再改任何文件，改判「该 profile 是否装了 `dsh-flash-presets` ≥ 0.2.13（含 `lib/tool-concurrency.js`）」，未装记 `n/a`、装了但版本旧记 `MISSING` 并给升级提示。B 段逻辑不变（dump-config 权威判据 + 带备份的幂等写入）。
- **测试** `plugins/plan-mode-ui/test/tool-concurrency.mjs`（11 项）：标记/幂等/不覆盖上游/missing/服务缺失/冻结对象/卸载撤销/targets 解析/install 打判据/环境变量关闭/工具晚到重试。
- **隔离复验**：全新 `DSH_HOME` 装 0.2.13 → dump 里 `persistent-in-memory` 1 处、`flash-lean-ptc-v3-lite/balance` 两行、`plan-mode-ui` 一行；启动后日志出现
  `[tool-concurrency] 已启用（目标 glob,grep；全局视图 未注册；已挂载会话 0）→ 会话挂载预设后会补标记`。
  预设是**按 agent 挂载**的，因此工具定义在会话作用域里才出现：打开任意会话后再 grep 一次，会看到
  `[tool-concurrency] 已标记 glob,grep（全局视图 + N 个会话作用域，共 M 处）｜调度器判据 glob=true grep=true`。
- **已知边界**：本模块只在带 `webServer` 的 profile（web / desktop）里生效——plan-mode-ui 整行都要等 `webServer`，headless / tui 下这行是 `pending`（隔离实验里实测：`dsh headless` 跑两次既不报错也不标记）。要做 headless 的并发优化，得把 tool-concurrency 拆成独立插件（它只需要 `tools`+`agents`），这是后续可选项。

### 0.2.12（2026-11-06，对齐审计：四层一次扫完；修掉 0.2.11 记下的路径 bug）

- **新增 `scripts/audit-align.mjs`**（`npm run audit:align`）：一条命令扫完四层，回答“为什么看起来还没对齐”。① 存储层按 DSH 自己的选取规则（同一会话目录只认世代号最大的日志）复核世代文件名 ⇄ `header.version`、"id/cwd → 目录路径" 的身份一致性与幽灵目录；② 解析层列 roster/alias/orphan；③ 记录层列“仍然写着历史 id”的会话（这些会话解析没问题，但头部芯片按 roster 查不到名字，会显示原始 id）；④ 组合层列“实际会跑哪个预设”，并区分“记录为空”的会话。退出码：存储层不变量被破坏或出现孤儿 id 时为 1。
- **修正 0.2.10 的一处误读**：`audit-compat` 把“没有记录 preset”的 1072 条会话算成“实际跑 selectedDefault”。实测这 1072 条全部来自自动化/实验运行（`~/Work/exp/…`、`~/Work/wbval/…`、`~/Codex-Sub`、`/tmp` 等，多为 700+ 事件的跑批），它们的组合由调用方的 profile 决定，不受 web profile 的默认值支配；真正吃 `selectedDefault` 的是**新建**会话。因此把 profile 默认值改成 lite 只影响新建会话，不能用来“修”这些老会话。
- **修掉 `sessionHeader()` 的路径拼接 bug**（0.2.11 结尾“留待单独评估”的那一条）：DSH 的会话 id **自带 `session-` 前缀**（`workspace.json`、`session.lock`、header 里都是这个形式），目录名就是这个 id；旧代码又拼了一次 `"session-" + id`，得到 `session-session-…`，于是兜底读盘永远落空，`delegationDepth` 恒为 0、`isSubagent()` 恒为假。现在两种写法都试（与 `composition-check` 的取样口径一致），命中后仍走同一份 30 秒失败节流缓存。
- **`retarget-session-presets.mjs` 与 DSH 的选取规则对齐**：以前它对同一会话目录里**所有**世代日志都做分析，于是同一个会话可能在报告里出现两次、备份里多出一份永远读不到的旧世代；现在只处理世代号最大的那份（与 `audit-align` 同口径），并在摘要里报出“历史世代文件（不动）”的条数（本机 274 份）。待改写会话数因此从 193 变成 162（193 里含 31 份历史世代文件）。
- **本机审计结论**（WSL，1622 个会话）：存储层 1622/1622 通过（0 世代不匹配 / 0 身份不匹配 / 0 幽灵目录 / 0 旧扁平布局；另有 274 份历史世代日志、182.6 MB 被正确忽略）；解析层 orphan 0（162 条走 alias）；记录层 162 条仍写历史 id（48 条在侧栏 → 芯片显示 `flash-lean-ptc` 之类的原始 id）；组合层 1072 default / 334 lite / 183 standard / 19 minimal / 12 ptc / 2 balance；侧栏可见 268，有内容但无 `session/title` 的 157 条（首次打开时由 DSH 回填）。

### 0.2.11（2026-11-06，组合自检：热重载后的「压缩/计划消失」不再靠人发现）

- **现场**：0.2.10 装好并重启后，17:31–17:44 之间打开的 **22 条**会话，其 agent 的预设组合层（tool executor / compaction / command-compact / command-goal / plan-mode）在 17:48:21 一次插件热重载中被连同旧插件图 dispose 掉，且不会自动重挂。用户看到的是斜杠菜单只剩 profile 全局命令（`export`/`feedback`/`permission`），「压缩 compact」「计划 plan」「目标 goal」全没了；再发一句就报 `The selected tool executor is unavailable. Load an executor in this composition before running the agent.`。会话日志、预设定义、alias 层全都正常——**纯运行期状态**，重启 dsh 即恢复（实测 22/22 恢复）。
- **新增 `lib/composition-check.js`**：激活后等 `agents`/`commands` 就绪，每 2 分钟（可调）扫一遍**已挂载** agent，用两个只读探针判定组合是否还在：`commands.list(agent)`（期望命令默认 `compact`，可用 `DSH_FLASH_PRESETS_SELFCHECK_EXPECT` 改）与 `tools.selectExecutor(agent)`（纯查找，缺失时抛 `ToolExecutorUnavailableError`）。任一失败即打一条错误日志，写明「命令层 = …、缺 compact/、工具执行器不可用」和处置（重启 dsh / 重选预设）；同一会话不重复刷屏。
- **可选自动重挂**（默认关）：`DSH_FLASH_PRESETS_SELFCHECK_HEAL=1` 时，从会话首帧读 `agentPreset`，调一次 `agentPresets.select(agent, id)`，随后复验命令层。**这一步会往会话日志写一条 `agent-preset/selected`**（等同用户在选择器里点一下），所以默认关闭，只在明确想自救时开。
- 开关与配置：`DSH_FLASH_PRESETS_SELFCHECK=0` 整体关闭；cordis 配置 `compositionCheck: {enabled, expect, intervalMs, heal}`。定时器走 `ctx.effect`，插件卸载即清；所有异常只记一条日志，绝不影响宿主。
- **测试** `plugins/plan-mode-ui/test/composition-check.mjs`（26 项）：健康不报警、只剩全局命令报警一次且不刷屏、仅执行器缺失也报警、heal 降级路径（读不到 preset 时不写日志地放弃）、heal 成功路径（临时 DSH_HOME + 真多帧 zstd 首帧 → 真调 select → 复验恢复）、服务缺失/list 抛错/无 id 的容错、开关与 expect 解析。
- 顺带修正：会话目录名就是会话 id（`session-<uuid>`），新模块按此解析；`lib/index.js` 里旧有的 `sessionHeader()` 用 `"session-" + id` 拼路径，对真实 id 永远落空（只是被兜底掩盖），本次未动它，留待单独评估。

### 0.2.10（2026-11-06，旧会话的根因修复：id 是持久化契约，不是显示名）

- **根因**：DSH 把 preset id 写进会话日志（首帧 `header.agentPreset`，以及每条 `agent-preset/selected` 事件），`resume` 时用 `agentPresets.resolve(有效 id)` 解析，解析不到就抛 `agent-preset/not-found`。上游没有 alias / hidden / fallback 字段（definition 只有 id/name/description/order/plugins），picker 只过滤 `broken`——所以**改名或删除 id 等于把旧会话弄丢**。0.2.6 删 `flash-lean-ptc-v3`、0.2.9 又删 `-v3-lite` 以外的兼容卡，都是同一个错误的两次发作。
- **新增运行时 alias 层** `lib/preset-alias.js` + `presets/legacy-preset-map.json`（12 个历史 id → `flash-lean-ptc-v3-lite`）：只在解析失败时回落一次；不新增 preset 定义、不进 picker、**不写任何会话文件**；方法不存在/签名变化/赋值失败一律静默退化；`ctx.effect` 卸载即还原；`DSH_FLASH_PRESETS_ALIAS=0` 可关。
- **启动自愈改为 opt-in**（`DSH_FLASH_PRESETS_HEAL=1`）：有了 alias 层就不需要在启动时改写用户数据，而启动改写会话正是 0.2.6 截断事故与 0.2.9 误判的同一类动作。
- **修掉审计口径错误**：`scripts/audit-compat.mjs` 原来只看 header，于是「header 已修好、事件里还写着旧 id」的会话被判成健康——本机 193 个打不开的会话就是这么被漏掉的。现在按 DSH 自己的语义判定（有效 preset = 最后一条 `agent-preset/selected`，没有才是 header），roster 也从 `dsh --profile web --dump-config` 取（扫目录会把别的 profile 与 `.bak-*` 算进来，曾把 `codex-contract-v1`/`-v2` 误判成“已定义”）。实测：WSL 1894 个会话 → 193 个经 alias 可解析、0 个孤儿；Windows 1007 个 → 6 个经 alias、0 个孤儿。
- **新增一次性迁移工具** `scripts/retarget-session-presets.mjs`（默认 dry-run）：只改「决定解析结果的那一处」（最后一条 selection，或 header），**帧级改写**、其余帧按字节拼接，首帧仍必须是一行 header；写前整份备份 + manifest，写后两遍独立校验（逐行语义比对 + 从磁盘重读确认无残留旧 id），失败即回滚；同步清理 `storages/session_projcache` 对应条目（缓存按 seq 续算，不清就会一直沿用旧值——这是 0.2.8 自愈“跑了但没生效”的原因）。沙箱实测：21 个真实会话样本 → 改写 19、失败 0、第二遍 0 改写（幂等）、`--revert` 后与 pristine 逐字节相同。
- **兼容闸门** `scripts/check-preset-compat.mjs` 接入 `npm run verify`：历史 tag 里的 id 必须三选一才算通过——当前仍定义 / 在 alias 表里 / 登记了例外；并断言 alias 表的 canonical 确实是被定义过的 id。
- 说明：`agent-preset/selected` 事件里出现过的**中间** id 不作改写（投影按顺序覆盖，不影响解析），只有真正决定解析结果的那一条会被迁移；因此升级后若不再需要 alias 层，跑一次 `npm run retarget:sessions -- --apply --yes --force`（先停 DSH）即可回到“零兼容层”。
### 0.2.8（2026-11-06，旧会话自愈：用户端无感升级）

- **新增 lib/compat-heal.js**：启动后 4s 扫描 DSH_HOME/sessions，把 header 里仍是历史 id（flash-lean / flash-lean-ptc / -v1 / -v2，白名单之外一律不动）的会话改写成 flash-lean-ptc-v3。
- **只重编码首帧**：事件帧按字节拼接，绝不解码-重编码（0.2.6 截断事故的成因）。
- **写盘四道闸**：整份备份 → 临时文件 → 写后校验（帧数 + 第 2..N 帧逐字节）→ rename；任一步失败保留原文件。
- **幂等**：第二次启动零改写；锁文件互斥，日志 logs/preset-heal.log，DSH_FLASH_PRESETS_HEAL=0 关闭。
- 沙箱验证：6 条旧 id 会话样本，修复 6/6、失败 0，逐帧比对只有 agentPreset 变化。
### 0.2.7（2026-11-06，旧会话兼容：id 不变 + 兼容别名）

- **预设 id 保持 0.2.6 的定义**：`flash-lean-ptc-v3-lite`（13 条，order 27，默认）与 `flash-lean-ptc-v3-balance`（3 条，order 26）。不再改动任何 id。
- **新增兼容别名预设 `flash-lean-ptc-v3`**（显示名「轻量PTC-v3（lean-v3 兼容）」，order 28）：规则、插件、压缩参数与 lite 完全相同，只为让 0.2.5 及更早写进会话的 lean-v3 id 能按 id 解析。选择器里因此有三张卡：lite / balance / 兼容别名。安装器（`--all-presets` 默认名单）、`merge-presets`、doctor、`verify-*` 与版本表同步收录。
- **彻底停止改写会话数据**：0.2.7 早期稿的 `scripts/migrate-legacy-preset-ids.mjs` 曾用 `zstdDecompressSync` 读会话日志再整文件重写——DSH 的 `session.v4.jsonl.zstd` 是**多帧 zstd**（首帧 header，其后每帧事件），该 API 只返回第一帧，重写会把事件流全部丢掉。现在 `--apply` / `--revert` 直接拒绝执行并打印原因，脚本只保留只读扫描（doctor `--sessions` 用）。**不要再用任何脚本原地改写会话文件。**
- 升级说明：旧 lean-v3 会话（记录 `flash-lean-ptc-v3`）直接可开，不需要迁移；`-v1` / `-v2` / `-v3b` 没有对应预设，仍需重选。

## 0.2.6-dev3（原 0.2.8，未发布，已并入 0.2.6）

- **新增两个预设，GUI 选择器里可直接手动测试**
  - `flash-lean-ptc-v3-lite`（「轻量PTC-v3 lite」，order 26，3 条规则）：保留 persona 前缀，只留引擎替代不了的三条——守语言与范围、不写密钥、同一路子连败两次就换并报确切命令与输出。
  - `flash-lean-ptc-v3-none`（「轻量PTC-v3 none」，order 29，无 persona 行）：对照组，不含任何人格规则，仅供手动对照。
- **实测与更正**（三床对照，n=5–15，详见 `实测证据.md`）：质量上各臂不可区分（算法床与 hard 床全满分；decision 床 20.13 / 19.73 / 19.73，CI 含 0）；token 配对检验无显著差异（lite/v3 = 0.86–1.22，CI 均含 1）。此前按 n=1 / n=3 得出的「lite 省 2/3 token」「persona 对结构化任务有用」等说法均在噪声内，已在文档中作废。该规模只能排除 >2 倍的差异。
- 校验同步：`verify-yaml` 对 `rules === 0` 的预设改断言「无 persona 行」，对 3 条版本只要求转录敏感一条；`compose` / `merge` / `doctor` / `install` 的预设清单都扩到四项。

## 0.2.6-dev2（原 0.2.7，未发布）

- **修复客户端插件加载失败（GUI 停在 “Failed to load plugins”）**：合并后 `lib/client.js` 的 `__ModuleLoader__.load({ id: ... })` 仍写着源码包名 `dsh-plan-mode-ui`，而 DSH 的客户端 boot graph 以**包名** `dsh-flash-presets` 作为行 id，`materialize(id)` 查不到 factory，该行永远“未到达”，前端渲染失败页。
  - 治本：`scripts/sync-lib.mjs` 同步 `lib/client.js` 时把注册 id 改写为 `package.json` 的 `name`；`--check` 按改写后内容比对，找不到源 id 直接报错（源码侧再改名不会被静默放过）。
  - 防回归：`npm run verify` 与 `prepublishOnly` 都跑 `sync-lib --check`。

- **0.2.6 的 tgz 作废**：`~/.dsh/profiles/web/vendor/dsh-flash-presets-0.2.6.tgz` 里存的仍是旧 id，任何人再执行 `dsh plugin add` 都会把缺陷装回来，故升版 0.2.7 并重打包。

## 0.2.6-dev1（未发布，历史稿）

- **预设收敛为两个：`v3` 与 `v3 max`**：
  - `flash-lean-ptc-v3-1-max` 更名为 `flash-lean-ptc-v3-max`（row id `preset-flash-lean-ptc-v3-max`，order 28），
    规则与原来一致（7 条，无预算 persona + 结尾一句 token 无限）；
  - 移除 `flash-lean-ptc-v1`、`flash-lean-ptc-v2`、`flash-lean-ptc-v3-1-high` 与旧式目录 `presets/legacy-0.1.5/`，
    `--all-presets` / `-AllPresets` 保留但等价于默认（两个都装）；
  - **描述改为面向使用者的口语**：v3「基础的轻量预设，满足绝大多数日常工作」，
    v3 max「解除预算限制的全量版，应对需要发挥能力的场景」；
  - 组合包补丁层同时插入这两个预设行，安装后选择器里就这两项。
  - **v3 兼容性（重点）**：`flash-lean-ptc-v3` 与 0.2.5 的差异**只有 name 与 description 两行**——
    id / order 27 / 20 个插件 / persona 3399 字符全部逐字节一致（md5 变化只来自那两行文案）。
    历史会话记录的是 id，恢复时按 id 解析，因此 0.2.5 造的 v3 会话在 0.2.6 下行为不变。
  - **升级路径实测**：临时 profile 先装 npm 上的 0.2.5、再装本地 0.2.6 tgz →
    预设行 1 → 2（v3 + v3 max），无 v1/v2/v3.1 残留，插件行 1，`ptc-runtime` 常驻生效。
  - 新增 `scripts/prune-stale-presets.mjs`：清理历史镜像里可能残留的退役预设行（v1/v2/v3.1 变体），
    默认只报告，`--apply` 才写文件且先备份。
  - 明确**不保留** v2 兼容条目：本地有 42 个旧会话记录 `flash-lean-ptc-v2`，这些会话不再保证可恢复（用户确认可放弃）。

- **计划模式并回主包，成为第三个组件（plan-mode v1）**：
  - `dsh-flash-presets` 一张卡带三个组件：预设 `preset-flash-lean-ptc-v3`、`preset-flash-lean-ptc-v3-max`，
    加计划模式 `plan-mode-ui`；组件各自可单独开关，安装 / 卸载 / 升级只有一个动作；
  - 实现：包根恢复 `main` / `exports` / `dsh.client` 与 `lib/`（由 `scripts/sync-lib.mjs` 从
    `plugins/plan-mode-ui/lib/` 生成），补丁层末尾多一条 `- insert:`，`name` 指向本包；
  - 版本口径：计划模式组件走 `plan-mode v1`（1.0.0），开发期的 0.7.x 只是内部编号，不再对外发布，
    旧 tgz / zip 移到 `internal-dev/` 留档；
  - 迁移：装过独立包 `dsh-plan-mode-ui` 的 profile，先 `dsh plugin remove dsh-plan-mode-ui`，
    再重装本包，否则两处都会插入 `plan-mode-ui` 行、协议注入两遍；
  - 验证（临时 `DSH_HOME`）：`--dump-config` 里预设两行 + `plan-mode-ui` 一行，
    `persistent-in-memory` 一处，组件计数 3。

- **旧版入口明确拒绝**：`presets/legacy-0.1.5/` 移除后，`install.sh --legacy` 与 `install.ps1 -Legacy` 改为报错并以 3 退出；此前是静默跳过，CI 会把它误判为成功。

- **文档**：`docs/实测证据.md` 增加「跨模型：长思考模型与 384k 上限」一节。10-18 那批三格 0/322 的原因是单次响应在约 14 分钟处被上游断流，不是 `maxTokens=64k` 截断；把上限提到 384k 复测后结果不变。

- **运行时调优随包落地**（run_code / PTC 开销）：
  - 预设包 `cordis.patch.yml` 末尾追加一段 `- id: ptc-runtime` → `executionMode: persistent-in-memory`：
    PTC 运行时改为**会话内常驻进程**，每个 program 只付一次启动成本；
  - 插件包 `plugins/plan-mode-ui/cordis.patch.yml` 里有同一段，只装插件也能拿到常驻运行时；
    两个包都装时是同一条覆盖的重复写入（同值），合成后只有一份配置；
  - 新增 `scripts/tune-runtime.mjs`（`--check` 默认 / `--apply` 幂等 / `--profile` 限定）：
    同时保证 A（`dsh-tool-fs-search` 的 `glob`/`grep` 打上 `isConcurrencySafe`，原生多调用可并行），
    改文件前先备份，改完做语法检查；`scripts/install.sh --with-plan-mode` 装完插件自动调用一次；
  - 实测（详见 `docs/压测-run_code开销.md`）：嵌套工具调用 **44 ms → 15 ms**（50 次仍线性，总 760 ms），
    每个 program 固定成本 **108 ms → 0**，原生 3 路 `glob` **492 ms → 204 ms**；异常后同进程存活。
    收益随 program 内调用密度线性增长（K=50 省约 1.5 s），单命令短任务几乎无感。

- **plan mode 插件 0.7.0**（0.6.0 起 9 处实现问题逐个修掉，测试 22/22）：计划阶段接上 DSH 原生 todo 列表——
  提示词要求 `todo_write` 先建条、再逐项打勾，并按阶段分流两种文案
  （规划期用 `TODO SYNC (deferred)`，执行期用 `TODO SYNC (do not batch)`，避免与 plan mode 政策打架导致列表永不出现）。
- 面板**只留档位/范围/Max**，「待办 x/y · 同步中」进度行已整体删除（0.6.5）；原生 TodoDock 是唯一 todo 视图。
  `/api/plan-mode/progress` 端点保留但不再被面板轮询。
- 判定收敛：`native` 只走一条判据链（投影 → planMode 服务 → 簿记），三处不再各说各话（0.6.6）。
- 新增无头对照开关 `DSH_PLAN_MODE_UI_HEADLESS=prompt`：照常注入计划正文、但不桥接原生计划模式（0.7.0）。
  实测（n=3，7 项验收）：light 与 full 均 **3/3 = 7/7**；full 中位 40.2 k tokens / 196 s，light 34.3 k / 147 s
  —— full 贵约 26%、慢约 33%，正确率无差异，故默认推荐 light。

- 计划把 plan mode 插件 `dsh-plan-mode-ui`（当前 0.5.2）的 zip **作为本版本 Release 的附件**发布，
  不再为插件单独建 Release / 打 tag（`plan-mode-ui-v0.5.2` 已于 2026-10-31 撤销）。
- 新增 `npm run verify:release`：断言 Releases 与远端 tags 里都没有 `plan-mode-ui-*`，
  且 `docs/PUBLISHING.md` 仍保留该约定（接进 `prepublishOnly`）。
- **npm 包收窄**：`files` 不再整目录发布 `docs/`，只发 5 篇（`CHANGELOG.md`、`版本与兼容性.md`、
  两份技术文档、`实测证据.md`）；`scripts/` 排除发布脚本。tarball 从 50 文件 / 381 kB 降到 34 文件 / 271 kB，
  审计记录、实验记录、`PUBLISHING.md` 不再对外可见。
- **README 链接对 npm 友好**：`benchmarks/`、`docs/images/`、以及不再随包发布的文档改用绝对链接，
  避免 npm 页面上出现死链；基准节补回「题目与评分规则只在仓库提供，npm 包不含 `benchmarks/`」这句口径。
- **npm 页面刷新一次到位**：npm 上的 README 是发布快照，0.2.5 之后仓库改了 5 个提交（基准节、数据修正、
  删英文摘要、链接改绝对）都没反映。本版发布即同步；发版后按 `docs/PUBLISHING.md` 第 8 节 c) 核对
  「含基准节 / 含 `bench:office`」两项为 True。
- 插件 `dsh-plan-mode-ui` 0.5.2 与本版**一起发**：zip 作为 Release 附件，npm 页面随后刷新；
  `docs/规格-规划插件-v1.md` 维持不进 npm 包（内部文档），使用者从仓库查规格。
- **两个安装器支持一次装齐**（`--with-plan-mode` / `-WithPlanMode`）：装完预设后按 `dist/*.tgz`
  → 现打一份 → 插件目录的顺序找来源，有 `dsh` 就执行 `dsh plugin add`，没有就只打印等价命令；
  不带开关时行为不变。
- **`doctor` 新增插件一节**（`[6]`，`--all` 同时跑 `[7]` 合成配置）：报插件版本、客户端入口、
  半装状态（profile 依赖有声明但 `node_modules` 没有）；没装只提示一行「纯可选」，不计失败。
- **README 实测表改由 `docs/bench-office-results.json` 生成**（`scripts/render-bench-table.mjs`）：
  基准行现算降幅，杜绝上次 `0.461 M / −83.7%` 那种手抄错误；`--check` 接进 `verify` 与 `prepublishOnly`。
- **版本一致性闸**（`scripts/verify-versions.mjs`）：以两个 `package.json` 为真源，断言 lock、marketplace、
  中英 README、版本表、插件兼容性文档、`dist/` 附件名共 7 处一致 —— 上线即抓到两处真实漂移（已修）。
- **测试补强**：插件 `test/run.sh` 由只跑 2 个改为全跑 11 个；CI 新增 `plugin-tests`（node 20/22 矩阵）
  与 `integration`（真 dsh 环境跑预设+插件整体自测），另在 verify job 跑无 dsh 的降级分支。

## 0.2.5 — 2026-10-30

本轮同时是本包在 npm 的首次发布；默认只装一个预设（v3）。

- **bundle 只发 v3**：`scripts/compose-bundle-patch.mjs` 默认只合成 `presets/flash-lean-ptc-v3.patch.yml`，加 `--all` 才合成三份。`cordis.patch.yml` 由 36.6 KB 降到 12.3 KB，安装后预设列表只多一项。

起因：用户报告"装完预设后不能选工作区"。排查后确认预设补丁不碰工作区/目录选择器/终端插件（全仓库 grep 0 命中），但过程中暴露出两个真实缺陷，加上一个缺失的诊断入口，一并补上。

**安装器**
- `merge-presets.mjs`：新增"认领历史残留"。旧安装方式写的裸行（`- id: preset-flash-lean-ptc-vN` 不在托管块内）以前不会被清理，重装即产生第二份同名预设。现在整条摘掉并入托管块；只摘"直接子行全部是本仓库预设 id"的条目，别人的行不动。
- `merge-presets.mjs`：写盘前调用 `lib/platform-tags.mjs` 解析 `!!js`，profile 补丁里只留 true/false。未知的 `!!js` 表达式直接报错，避免把非标准 YAML 写进用户配置。

**新增**
- `scripts/doctor.mjs`：体检 DSH 版本、托管块数量、块外残留、`!!js` 行号、标准 YAML 解析（报错带行号）；`--fix` 就地解析标签并备份，`--dump` 额外跑 `dsh --dump-config` 确认预设被合成进去。
- `lib/platform-tags.mjs`：平台标签解析的唯一实现，安装器与医生共用。

**修复（issue #5）**
- v1 / v2 的 persona suffix 以 `Your working directory is {{cwd}}.` 开头，而 DSH 的提示词插值是严格模式，只注册了 `provider` 与 `model`；选中这两个预设后**任意一轮对话都会抛 `unknown prompt variable "{{cwd}}"` 并中止**，等于 v1/v2 完全不可用。工作目录本来就由 runtime context 注入，占位符是 Claude Code 沿用的写法，已两处删除（v1、v2 源文件；`cordis.patch.yml` 重新合成）。
- `verify-presets.mjs`：新增"未注册提示词变量"断言——扫描三个预设源文件与合成产物里的 `{{var}}`，只允许 `provider`/`model`，出现别的直接判失败。此前这类错误只会在用户选中预设时才炸。

**验证**
- 合成"用户行 + 老式残留"的补丁：安装后 v3 只出现 1 次、`!!js` 为 0、js-yaml 直接解析通过、用户自己的行保持原样。
- 连跑两次安装：字节级幂等。
- 真实 profile（`zz-duptest`）：`dsh --profile zz-duptest --dump-config` 正常，linux 下 `tool-pwsh` 落成 `disabled: true`。
- `bash scripts/selftest.sh`：30 项通过。

响应 issue #4（Gold-Ballon）。四条缺陷已复核，全部属实，已逐条修复。

**校验器**
- `verify-yaml.mjs`：`EXPECT` 补入 v3（order 27 / 13 条规则 / 0.25 / 20000）；默认分支新增对合成产物 `cordis.patch.yml` 的解析断言；安装器分支由「含 v1/v2」改为「含 v1/v2/v3」。此前 v3 的 YAML 损坏可完整绕过 `npm run verify`。
- `verify-yaml.mjs`：未找到 js-yaml 时退出码由 0 改为 2（原为 fail-open）；`install.sh` / `install.ps1` 区分「通过 / 跳过 / 失败」三态，不再把跳过打印成通过。
- `verify-presets.mjs`：安装层行尾断言由字面 `\n` 改为 `\r?\n`，CRLF profile 下不再误报。

**文档与产物**
- v2/v3 的压缩参数注释对齐实际值（0.25 / 保留 20000，原注释残留 v1 的 300k/50k）。
- `docs/版本与兼容性.md` 版本表补到当前版本；`marketplace/plugin.json` 版本同步（改版本时两处一起动）。
- `candidates/flash-lean-ptc-v4-plan-accept.patch.yml` 改为 `- insert:` 形态：扁平 `- id:` 行在预设包里会被静默忽略，此前该候选实际不生效。

**变异测试**（新增防线均实测通过）
- 破坏 v3 缩进 → `verify-yaml` exit 1（js-yaml 报 bad indentation）
- CRLF profile → 安装层校验 exit 0（原会 3 项误报）
- 移除 js-yaml → exit 2 且打印「跳过，不等于通过」

- **安装器**：`install.sh` 的 `PRESETS` 默认只有 `flash-lean-ptc-v3`，新增 `--all-presets`；`install.ps1` 对应 `-AllPresets`。legacy 目录式安装固定走 v1（旧式目录本就只提供 v1）。
- **校验链**：`verify-yaml` 反向断言合成产物不得混入 v1/v2；`check-ps1` 的名单断言改为"presets/ 的子集且含最新"，不再要求与源文件列表全等。
- **文档**：README 中英、版本与兼容性表、本文件同步为"默认只装 v3"。
- **npm**：本包首次发布到 npm（此前 npm 上最新只有 0.2.4）。plan mode 插件仍不在 npm 发布范围内。

## 0.2.4 — 2026-10-24

**修复**
- npm 包缺 `presets/legacy-0.1.5/`：DSH 0.1.7 以前的目录式回退只有 v1 提供，此前只存在于仓库、没进 tarball，从 npm 安装的用户拿不到。
- npm 包缺 `.gitattributes`：包内自带的 `scripts/verify-presets.mjs` 依赖它判断行尾，导致在解包目录里跑自检直接 3 项失败。

**验证**：`npm pack` 后解包、在包内跑 `node scripts/verify-presets.mjs --repo-only` 应全绿（已实测）。

## 0.2.3 — 2026-10-24

**预设**
- v3 规则 5/6 的 shell 工具表述改为「不用 shell 浏览文件，但命令自身输出可管道给 head」，消除自相矛盾（PR #3）。
- v3 规则 6 的临时目录写法改为 PowerShell / cmd / POSIX 三态（`$env:TEMP`、`%TEMP%`、`/tmp`），此前 `$TEMP` 在 cmd 下不成立。
- v3 规则 13 缩进对齐，块标量里不再视觉脱离列表。

**文档**
- 删除「未发布（计划 0.2.3）」幽灵版本章节；npm 渠道版本引用统一到 0.2.3。
- tarball 文件数更正为 28（原写 22），README 仓库结构补上 `plugins/`、`candidates/`、`marketplace/`。

**工具与 CI**
- 新增 `scripts/lint-presets.mjs`：规则编号、缩进、自相矛盾（双向）、平台路径、版本引用漂移。
- 新增 `scripts/verify-runtime.mjs`：核对 `dsh --dump-config` 里的 order / 阈值 / 规则条数 / PTC。
- `verify-presets.mjs` 补仓库层取值断言（此前 `--repo-only` 会跳过全部取值检查）、行尾与文档链接检查。
- CI 增加最小权限 `permissions: contents: read` 与两步新校验；`.gitattributes` 的 `*.ps1` 改为 LF（原先声明 CRLF 但实际是 LF）。

**新增文档**：`CONTRIBUTING.md`、PR 模板、三份审计报告（结构 / 深挖 / 运行时）。
## 0.2.2 — 2026-10-21

**新增**
- 发布到 npm（`dsh-flash-presets`）：`dsh plugin --profile web add dsh-flash-presets` 即可安装。README 增加 npm 徽章、npm 安装段与 GitHub 直装段。
- `verify-presets.mjs` 新增开关：`--repo-only`（只跑仓库层，供发布前守卫与 CI 用）、`--all`（要求三个预设都已安装）。
- `package.json` 增加 `prepublishOnly`：合成一致性 + YAML 校验 + 仓库层结构校验，任一失败即中止发布。

**修复**
- `verify-presets.mjs` 安装层误报：未安装的预设此前仍逐项断言，导致只装 v3（常态）时报 25 项失败 → 改为跳过未安装项，仅 `--all` 时要求齐全。
- `verify-presets.mjs` 切片范围：此前只在托管块内找预设行，而 `dsh plugin` 合并后的预设行可能落在块外（实测两者并存）→ 改为在整份补丁内定位；PTC 与绝对路径检查同步改为只看已装预设。

## 0.2.1 — 2026-10-20

**新增**
- `presets/flash-lean-ptc-v3.patch.yml`：lean-v3，order 27，13 条行为规则，压缩 0.25 / 20k，PTC 展示层。
- 文档重写为可审计形态：README + 实测证据 + 版本与兼容性。

**修复**
- `merge-presets.mjs` 的托管块只拼前两个预设（`bodies[0] + bodies[1]` 硬编码）→ 改为 `bodies.join()`。
- `compose-bundle-patch.mjs`、`install.sh`、`install.ps1`、`selftest.sh` 中硬编码的 v1+v2 列表 → 支持三预设。
- `verify-presets.mjs` 对整块做宽松匹配（v2 的 0.3/50000 会被 v1 满足）→ 改为**逐预设切片断言**，各自核对 order / 规则条数 / 压缩阈值 / 保留预算 / 裁剪阈值 / PTC / tool-workflow。
- 安装器提示文案统一为"v1 / v2 / v3，v3 为主版本"，sh 与 ps1 两侧同步；`check-ps1.mjs` 改为先解析整段预设列表再比对，避免只匹配到第一个 `vN` 时误判通过。

**验证**
- 模拟安装回归（临时 `DSH_HOME`）：安装 → `--dump-config` 三预设 → 重复安装幂等 → 卸载干净。
- `compose-bundle-patch.mjs --check` 一致；`verify-yaml.mjs` 通过；`npm pack` 含三预设（发布时 7 个文件，补齐 `scripts/`、`docs/` 后为 22 个）。

**发布后修正（2026-10-21）**

标签 `v0.2.1` 已移到包含这些修正的最新提交。

- 恢复 README 的「当前版本：v0.2.1」锚点。`selftest.sh`、`publish.sh`、`publish.ps1` 都靠它取版本，改写文风时丢了，导致自测与发布脚本同时失效。
- `install.ps1` 的完成文案补上 v3；`check-ps1.mjs` 改为先解析整段预设列表再比对。
- README 删除重复段落；`compactionRetries` 按预设注明（v1=2，v2 与 v3=1）。
- CI 的组合包断言补上 v3；`files` 补 `scripts/` 与 `docs/`；`compose --check` 分别打印字符数与字节数。
- `merge-presets.mjs`：托管块缺结束标记时拒绝改动（此前会静默删掉块后的内容）；写入时沿用文件原有换行符，Windows 的 CRLF 配置现在能逐字节还原；接受 `[ ]` 这种空数组写法。
- `install.sh`：`--profile` 缺参数时给出明确提示并以 2 退出。
- 旧式目录回退的 `preset.yml`：order 由 22 对齐为 21，名称补上 v1，描述不再引用已删除的非 PTC 预设。
- README：行为约束按五类重写（此前漏掉工具与输出那组）；版本历史补上 `v1.0.0`、`v1.0.1`、`v1.1.0` 三个旧标签的归属。
- `check-ps1.mjs`、`selftest.sh` 补文件末尾换行。
- CI 的 `actions/checkout` 与 `actions/setup-node` 由 `@v4` 改为钉提交 SHA（v4.2.2 / v4.1.0），避免上游标签被移动带来的供应链风险。
- `install.ps1` 补 `-Help`，与 `install.sh --help` 对齐；`check-ps1.mjs` 增加「两个安装器都有帮助入口」的断言。
- LICENSE 署名由 `dsh-flash-presets contributors` 改为 `LarryE135`。

## 0.2.0 — 2026-09-30

- 声明为 DSH 组合包（`dsh.bundle.patch` → 单文件 `cordis.patch.yml`）。
- 新增 `v2`：步数预算、少想多试、一次合并验证、先交最小可行产物。
- CI 增加 bundle-install 任务（真实 `dsh plugin add` + `--dump-config` 断言）。

## 0.1.0 — 2026-09-23 ~ 09-24

- 首个发布：`v1`（压缩 0.3 / 50k、14 条约束、PTC 展示层），含三平台安装器与旧版目录式回退。