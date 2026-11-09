# 变更日志

> **版本口径（2026-11-07 发布整理）**：对外发布过 **0.2.6**（GitHub tag）、**0.2.7**（GitHub tag，npm 跳过）、
> **0.2.8**（GitHub tag + npm）、**0.2.9**（GitHub tag + Release + npm，2026-11-07 02:23 CST 发布）、**0.3.0**（当前版本，GitHub tag + Release + npm，2026-11-07 发布；原计划名为 0.2.10）。0.2.6 定稿时并入的迭代号 0.2.7–0.2.14 从未单独发布，与 0.2.7
> 这个正式版本号无关 —— 那批内容现已改名为 `0.2.6-iterN`，仍作为「同日迭代」下的四级标题保留。

## 未发版修正（2026-11-09，`main` 上，不升版号）

> 按作者要求：**不升版本号、不发 Release**，对外身份仍是 0.3.0。这一批换的是「机制」，不是规则文本。

### 新增：交付门 delivery-gate（默认关闭）

`lib/delivery-gate.js`，以 `dsh-flash-presets/delivery-gate` 单独成行挂在 profile 上（见 `cordis.patch.yml` 末段）。

- 工作区里存在 `verify.sh` 时，**回合收尾自动跑一次**；通过就放行，不通过就把退出码与输出尾部 steer 回会话，
  同一会话最多回灌 `maxRounds` 次（默认 2）。超时按失败处理。
- 为什么做成机制：2026-11-08 的三臂实测（P15654，19 组官方数据本地判分）里，三份实现都在结束语里如实写了
  「17–19 超时」「未覆盖」，然后照常交付 —— 说明「要求写清楚」这一层已经到位，缺的是「不达标就不许结束」。
- 实测（P15654，19 组官方数据）：门触发了两次回灌，模型确实收到失败清单，但完成度没有提高（15/19，与不加门相同），
  成本高约 35%。原因是失败点在算法（每询问 O(L) 超时），不是纪律 —— 门禁必要但不充分，细节见 `docs/实测证据.md`。
- 默认 `enabled: false`：它会在用户会话里执行工作区脚本，属于要用户显式打开的开关；关掉也可用环境变量
  `DSH_DELIVERY_GATE=0`。
- 依赖声明：`peerDependencies` 增加 `@deepseek-ai/dsh-tools` 与 `zod`（与 `@deepseek-ai/dsh-llm` 同口径），
  否则以 link 方式挂载时模块解析不到 dsh 自带的副本。

### 变更：doctor 新增第 9 项检查

`scripts/doctor.mjs` 现在会**静态比对** profile 里每个 `@deepseek-ai/*` 包声明的精确版本要求与本机 dsh 版本，
对不上的直接判红并给出修法。原因是 dsh 挂载时会把版本不符的插件行**静默跳过**，只在 stderr 说一句
`disabling profile plugin row …`：用户看到的是「工具少了」，而不是「装错了」。

实测背景：headless profile 里的 `@deepseek-ai/dsh-tool-fs-search@0.2.1-rc.5` 就是这样丢了 `glob` / `grep`，
几十次 bench 跑批都没发现（32 条历史结果全部带这个偏差）。

### 脚本：runDshCapture

`scripts/lib/run-dsh.mjs` 增加 `runDshCapture()`（`spawnSync`，同时拿 stdout/stderr），供需要读 stderr 的检查使用；
`execFileSync` 只回 stdout，而上面的告警只写在 stderr 上。

### 否决：v4 候选规则「契约先行」与「长文阅读」（测过，不加）

Windows 基准（660 次作答）里 polyglot 题族只有 30% 通过、105 次失败里 63 次是「被测代码异常/断言失败」，
据此起草了「先写 3–8 行公开契约（签名 / 返回类型 / 异常类型 / 错误消息原文 / 输出格式）再动手」这条候选规则，
并用三个本地仪器做了 A/B（题面取自 exercism/python main，判分用题目自带测试，两臂只差一段 persona 文本）：

| 仪器 | v3 | v3 + 契约规则 |
|---|---|---|
| 给题面（7 题） | 5/7 | 未测 |
| 只给题名（Exercism 题族） | 13/17 | 8/10 |
| 自建一致性微基准（6 个精确规格 + 隐藏测试） | 12/12 | 12/12（token 27.6k vs 27.6k） |

微基准两臂全过，说明规格写清楚时模型本来就照做 —— 规则的前提不成立；另一条仪器上两臂差 1 题，在噪声内。
副产物：加规则会让同题多花 token（109k → 151k）。**这条规则不进 v4**，详细数据见 `docs/实测证据.md`。

长文侧同日也测了两条（引用证据逐词比选项 / 整篇顺读不信关键词），仪器是 LongBench-v2 short 的 8 道题：

| 臂 | 通过 | token/次 |
|---|---|---|
| v3 基线 | 4/15（27%） | 95.8k |
| v4e 证据表 | 4/14（29%） | 92.4k |
| v4w 整篇顺读 | 4/14（29%） | 98.9k |

三臂在 7/8 题上给出完全相同的字母、每题重复内也稳定，抽查失败项的终答都能引原文句子支撑自己选的选项 —— 长文偏差不是「没读完」，读法与引用纪律都改不动。**两条长文规则同样不进 v4**。顺带一条读数提醒：基准里「长任务注意力 88.4%」是 needle 100% + chain 94.4% + lb2 73.6% 的混合，合成检索与 LongBench 不要混算。

### 更正：压缩阈值是安全网，不是降本手段（注释与一处旧读数）

按 `thresholdTokens = min(window × thresholdRatio, pressureBudget)`（窗口 1,000,000），本预设 0.25 = 250k 才压缩。实测（2026-11-09）：**109 个运行的上下文峰值中位 20k、p90 34k、最大 126k，250k 从未触发**；把阈值压到 0.04（40k）在 O08 上跑，峰值 39.6k，照样一次没压缩 —— 因为 `tool-result-pruner` 已经把每次工具输出压到约 5.2k 字符。

同时更正一处口径：v4-bench 里「10/32 运行超 250k token」是**累计 token**（每次请求求和，含 cache 读），不是上下文峰值。

因此 `presets/*.patch.yml` 里那段注释改写为可核对的表述（原句「长会话里大量步数停在 300k 以上」在 109 次测量里没有出现过）。顺手测了真正起作用的旋钮（O01，n=4）：pruner 8192 → 2048 每次 token 中位 297k → 228k，但 office 床 Q 无分辨力，暂不下发布结论。

## 未发版修正（2026-11-08，`main` 上，不升版号）

> 按作者要求：**不升版本号、不发 Release**。这批是 CI、脚本细节与随包文档的修正，对外的身份仍是 0.3.0（npm 与 Release 都没动），装法不变。

**只改 CI、脚本细节与随包文档：预设 id、规则文本、别名表、模型行为一律不动。**

这一批是 0.3.0 的「对账」—— 把第六轮审计里那些「本地过、CI 不过」和「文档写的不是事实」的条目一次清掉。

### CI 收口（以前 CI 绿，不等于仓库闸门绿）

- `verify` job 现在直接跑 `npm run verify`（10 个检查的唯一入口）。此前 CI 是逐项手抄，**漏了 `sync-lib --check`、`guard-bench-leak`、`verify-versions`、`render-bench-table --check` 四个** —— 也就是「`lib/` 忘了从 `plugins/plan-mode-ui/lib/` 同步」「版本号漂移」「基准表漂移」这几类问题在 CI 里完全看不见。
- 新增一步「发布面卫生与基准复核清单」：`verify-release-hygiene.mjs` + `bench-release-checklist.mjs`，这两个以前只挂在 `prepublishOnly` 上。
- 修掉一条**永远成立**的断言：卸载后检查的是 `preset-flash-lean-ptc-v2`，而安装器从 0.2.6 起就不写 v2 了；现在改查 `preset-flash-lean-ptc-v3`。
- 新增探针 `tools/probe/alias-vs-config.mjs`（也可 `npm run verify:alias`）：把别名表与**真实组合配置**对一遍 —— CI 里喂 `dsh --profile ci --dump-config` 的输出，断言别名指向的 id 真的在配置里、`flash-presets-alias` 行真的在。0.2.8 → 0.2.9 那次事故的形状（会话里的 id 解析到包内不存在的定义）从此有闸门。
- 仍然不能自动化的：真实「建会话 → 升级 → resume」需要能跑模型的 provider，CI 没有凭据，继续留在人工检查单（见《审计索引》第 7 节）。

### 新 lint 规则：随包文档的陈述对账

`scripts/lint-presets.mjs` 增加「2.5 陈述对账」：把 lite 说成默认卡的说法直接判红；同一行里既有「待发 / 未发布」又出现**当前版本号**也判红（历史章节与变更日志本身不受影响）。

规则上线当场抓到一条：`docs/审计索引-0.2.9.md` 还写着「0.3.0 待发」，已改成三通道发齐。

### 文档对账

- `README.en.md`：「today's lite」改成「today's `flash-lean-ptc-v3` (lean-v3)」；`-lite` 的区间由「0.2.7–0.2.8」改成「0.2.6–0.2.8」（`git ls-tree v0.2.6 presets/` 可复现）。
- `cordis.patch.yml` 与 `scripts/compose-bundle-patch.mjs` 的注释：「历史 id」由 3 个改成 **5 个**（`v3-lite / v1 / v2 / flash-lean-ptc / flash-lean`），与 `lib/preset-alias.js` 的别名表一致。
- `CHANGELOG` 里关于 `npm deprecate` 的旧叙述订正：标记早已补上（`npm view dsh-flash-presets@0.2.5 deprecated` 可复现），原文依赖的 Automation token 已随 npm 收紧 bypass-2FA 失效。
- `CONTRIBUTING.md`：删掉「本仓库是纯补丁层，没有运行时代码」这句错话 —— 仓库确实带运行时（`lib/`），且**真源在 `plugins/plan-mode-ui/lib/`**，改运行时只能改真源。
- `plugins/plan-mode-ui/NOTICE.md`：「64 项自测」改成「26 个测试文件」（`bash test/run.sh` 的实测输出）。
- `README` 的「更新与卸载」写清升级语义：用精确版本安装后 `dsh plugin update` **不会**自动升级，升级 = 再 `add` 一次新版本；并说明 pnpm 留下的 `minimumReleaseAgeExclude` 行是正常的。

### 脚本小修

- `tune-runtime --check` 以前会被当成未知参数拒绝（而它自己的用法行就写着 `[--check]`），现在接受；与 `--apply` / `--revert` 同时给出时明确报错退出 2。
- `install.ps1` 退出时还原 `$env:DSH_HOME`（dot-source 或交互式调用不再污染调用者会话）。
- `publish.sh`：Release 附件**每次重打**（以前 `dist/` 里有同名 zip 就直接复用，容易传上旧内容）；删掉「临时放宽 tag 规则集 → `git tag -f`」的错误指引，与「已发布的 tag 永不移动」保持一致。
- `publish.ps1`：仓库描述文案由「v1/v2 预设」改成「v3 十三条 / v3 balance 三条」。

### 兼容性

- 预设 id、规则文本、描述、别名表：**与 0.3.0 完全相同**。老会话、老配置不需要任何迁移。
- 装法完全不变：`add dsh-flash-presets@0.3.0`（或 tag `v0.3.0`）。这批修正只影响 CI 与随包文档，已经装好的东西不用动。

## 0.3.0（2026-11-07，发布）

**只改显示名与描述，不改任何 id、规则文本或模型行为。**

原计划号是 0.2.10；这一版带上了会改变安装器与诊断行为的内容（见本节后半），按语义化版本升到 0.3.0。

- `flash-lean-ptc-v3` 的描述改成「效率最高的版本，适合绝大多数日常工作。」—— 原来那句「id 一直是 `flash-lean-ptc-v3`，
  不再改名，旧会话可直接打开」是在向用户解释我们自己的内部约定，picker 里占一行还答非所问。
- `flash-lean-ptc-v3-balance` 的显示名从「精简·PTC balance」改成「精简·PTC v3 balance」（与 v3 同一族、一眼看出配对），
  描述去掉「id 固定为 `flash-lean-ptc-v3-balance`」那句。
- **改名为什么不影响兼容**：DSH 解析预设和会话记录用的是 `config.id`；`config.name` 只是 picker 里显示的文字。
  本包的别名层、`presets/legacy-preset-map.json`、会话文件全都只认 id，因此改名后 `--dump-config` 里两行的
  `config.id` 与 0.2.9 逐字节相同，`-lite` / v1 / v2 等旧 id 照旧解析到 `flash-lean-ptc-v3`。
- 兼容行（`-lite`，脚本安装升级时才会写）的描述不再照抄 v3 的新文案，改为说明它只用于打开旧 lite 会话。
- `package.json` 与 `marketplace/plugin.json` 的描述不再自称「轻量PTC-v3 lite」；两个安装器的完成文案同步改名
  （`scripts/check-ps1.mjs` 断言两侧逐字一致）。
- 文档：删掉 README 里那条「原 lean-v3 现改名为『轻量PTC-v3 lite』」的过期说明；`-lite` 的历史区间统一写成
  **0.2.6–0.2.8**（`v0.2.6` 这个 tag 的 `presets/` 里就已经是 lite，不是 0.2.7 才改的）。
- **修掉第六轮审计的 5 条**（U1-2 / U1-3 / U2-1 / U2-3 / U3-1）：
  - **U1-2**：`install.sh` / `install.ps1` 会把使用者照 README 自己加回的 `preset-flash-lean-ptc-v1` / `-v2` 行当「历史残留」删掉，
    还打印「已并入托管块」。现在认领只针对安装器真正写过的 id（v3 / balance / `-lite`），且要先比对结构
    （`name: '@deepseek-ai/dsh-agent-preset'` + `config.id` 与行 id 一致）；v1 / v2 这类自加行原样保留，并打印「已保留你自己加的预设行」。
    selftest 增用例（装一次后 v1 行仍在、v3 卡照常装上）。
  - **U1-3**：脚本安装形态下 doctor 与 audit-compat 都说「旧 id 由兼容层解析 ✓」，可脚本安装根本没有别名层。现在两者按安装形态分叉：
    `audit-compat` 加 `--no-alias` / `--alias-layer` 与自动探测（看 profile 的 `dsh.profile.bundles`，再退到 `lib/alias-plugin.js` 是否存在），
    没有别名层时把 aliased 记成 `unresolved` 并 exit 1；doctor 第 7、8 节在脚本形态下改成「本形态没有兼容层 → 打不开」并计入 problems。
    两处「跑 `retarget-session-presets.mjs`」的建议删掉（那个脚本不随包，而且与「本包不写会话」相反）。
  - **U2-1**：`publish.sh` 守卫 ③ 从「tag 是 HEAD 的祖先」改成「`HEAD == tag^{commit}`」，并加一条「tag 那次 CI 不能有 failure / cancelled」
    （只在装了 `gh` 时检查）。0.2.9 正是在 tag CI 红着、且 npm 包来自 tag 之后的提交的情况下发出去的。
  - **U2-3**：`check-preset-compat` 的「有定义」改成「随包发出去的定义」（读 `package.json` 的 `files` 白名单，不再认仓库里随手放的 yml），
    并断言组合包里有 `flash-presets-alias` 行、`exports["./alias"]` 存在、`lib/alias-plugin.js` 在；这道闸门同时进 `prepublishOnly`。
  - **U3-1**：别名自检不再借 `note()` 打「旧会话继续可用」（全新装、没有任何旧会话时也打，纯噪音），探测 id 固定挑 `rulesDiffer: false` 的那条。
- **发布**：GitHub tag `v0.3.0` + Release `v0.3.0`（附件 `dsh-flash-presets-v0.3.0.zip`，由 `git archive` 打出）——
  预设 id / 规则 / 模型行为与 0.2.9 一致，只有显示名、描述与安装器/诊断行为的修正。**npm 已于 2026-11-07 发布 0.3.0 并成为 `latest`**（`gitHead` = `5449ecb`，与 tag 一致；39 个文件 / 解包 613 629 B / shasum `c276c00d`）；tag 指向 `5449ecb`；发布后的文档订正（README 的 npm 时效说明、PUBLISHING 状态表、本节发布说明）留在 `main` 上，移动 tag 被仓库的 tag 规则集拒绝（`push --force` 报 repository rule violations），所以**发 npm 时从 tag 检出**，保证 npm / Release / tag 三者一致。
  发布前还需先 `npm login`：实测 `npm whoami` 返回 `E401`，`~/.npmrc` 里的 token 已失效（本机账号用 passkey / PIN，没有 TOTP）。
- 顺手修掉两处 0.2.9 遗留的事实错误（不发版也能修的那种已经在仓库里改）：`package.json` 的 `publishedVersion`
  仍是 0.2.8（现同步为 0.2.9）；0.2.9 的随包文档写着「npm 待发」，而它已于 2026-11-07 02:23 CST 发布到 npm。

## 0.2.9（2026-11-07，GitHub Release `v0.2.9` + npm）

**把预设 id 改回稳定值，并让「旧会话能不能打开」不再是运气。** 桌面端装上新版 0.2.8 后旧会话直接打不开 —— 根因是
0.2.7 把 13 条规则版的 id 从 `flash-lean-ptc-v3` 改名成 `flash-lean-ptc-v3-lite`。DSH 把 preset id 持久化在会话日志里，
改名之后那些会话在解析这一步就找不到预设。修法是**不动标识符**：id 保持 `flash-lean-ptc-v3`，只演进规则文本与描述，
0.2.9 起不再改名。本版**不改预设规则文本、不改模型行为**。

### 改动

- **lite 的 id 回到 `flash-lean-ptc-v3`**：`presets/flash-lean-ptc-v3.patch.yml` 里条目 id 与 `config.id` 都是
  `flash-lean-ptc-v3`，`name` 用「精简·PTC v3（lean-v3）」，`description` 注明 id 稳定、旧会话可直接打开。0.2.7–0.2.8
  那个 `-lite` 只是 v3 的一次改名，规则与 v3 完全相同，**不再做成卡片**，只作为历史 id 交给别名层解析。规则仍是 13 条，order 27。
- **发行包收窄成两张卡：lean-v3 + balance**。中间曾把 0.2.5 的 v1/v2 也做成随包发行的「兼容卡」，同一个 0.2.9 里又撤掉：
  发行包只负责「正式发布的 lean-v3」与「新增的 balance」，v1/v2/v3b/v3e 一律不随包发行。
- **所有发布过的历史 id 都能解析**（0.2.8 能打开的会话，0.2.9 必须还能打开）：`presets/legacy-preset-map.json` 的别名表是
  `flash-lean-ptc-v3-lite`（规则与 v3 逐字相同）、`flash-lean-ptc-v1`、`flash-lean-ptc-v2`、`flash-lean-ptc`、`flash-lean`
  共 5 条，全部指向 canonical `flash-lean-ptc-v3`。规则不同的那 4 条标 `rulesDiffer: true`，首次命中打印一条警告
  （打得开优先，规则变化必须可见；要原规则就在 profile 补丁里加自己的行）。`presets/compat-exceptions.json` 因此清空，
  只保留机制与 `$policy` 说明。
- **别名层独立成一行插件**：`lib/alias-plugin.js`（`inject: ['agentPresets']`）由 `cordis.patch.yml` 里的
  `id: flash-presets-alias` 载入。以前它挂在 `plan-mode-ui` 那一行上，而那一行 inject 了 `webServer`，桌面端（Electron）
  会停在 pending —— 「即便做了兼容层」仍然打不开。现在任何宿主都能加载，与计划模式是否可用无关。
- **启动自愈删除**：`lib/compat-heal.js` 已删除（`DSH_FLASH_PRESETS_HEAL` 不再有任何作用）。它改 header 却不失效 DSH 的
  会话投影缓存，实际基本无效；锁文件还不释放；名单里还挂着 `flash-lean-ptc-v1` / `-v2`，一旦被打开就是强制对齐。
  从此**本包没有任何代码写会话文件**。
- **脚本安装不再悄悄弄丢 `-lite` 会话**：`install.sh` / `install.ps1` 这条路没有别名层，所以 `merge-presets.mjs` 发现旧
  托管块/旧裸行里出现过 `flash-lean-ptc-v3-lite` 时，会额外保留一行兼容行（规则同 v3、`order: 99`、名字标「勿选」）。
  全新安装不会多这一行；`--no-legacy-lite` 可显式关掉。
- **脚本安装与插件卡不再能叠成重复预设**：profile 的 `package.json` 里 `dsh.profile.bundles` 已含本包时，两个安装器直接
  `exit 4` 并给出二选一的做法，`--force` / `-Force` 才继续（以前只提示「都装不会报错」，实际预设会重复出现）。
- **兼容性闸门真正生效**：`scripts/check-preset-compat.mjs` 在没有 git tag 时 `exit 2`（以前静默通过）、冻结 id
  （`flash-lean-ptc-v3` / `-balance`）不许进例外表、例外必须是 `{ reason, fallback, since }` 且该 id 真的在历史里、
  别名条目必须是 `{ rulesDiffer: boolean }`。CI 新增这一步，`actions/checkout` 改成 `fetch-depth: 0` + `fetch-tags: true`。
- **`doctor` 不再误报**：历史 id 列表改成从 `legacy-preset-map.json` 读（以前写死三个，v1/v2 写进补丁也不报）；新增
  「脚本安装 + 插件卡叠加」判定与「组合包里有没有 `flash-presets-alias` 行」自检；结论按问题类型给不同修法；
  `DSH_JS_YAML` 优先；提示里的安装命令一律钉版本（不再给裸包名）。
- **`publish.sh` 加四条前置守卫**（fail-closed）：工作区必须干净、`package.json` 版本必须等于标签、标签必须在当前分支历史上、
  远端 `main` 不能有本地没有的提交。0.2.9 的标签一度打在不在 `main` 上的提交，这四条就是为此加的；`DRY_RUN=1` 只检查不推送。
- **CI 断言安装器不碰会话**：装一次 + 卸一次，`sessions/` 下文件的校验和必须完全不变（用 POSIX `cksum`；
  macOS runner 上没有 `md5sum`，BSD 的 `xargs` 也不认 `-r`）。
- **`verify-yaml` 的「安装目标」断言修正**：以前只要路径里带 `profiles/` 就要求补丁里含 v3 行，于是
  ①插件卡安装的 profile（行在包的 `cordis.patch.yml` 里，profile 补丁里只有使用者自加的行）与 ②任何自加行的
  profile 一律判失败 → `install.sh` 走回滚；连带 ③升级路径要写的 `-lite` 兼容行永远写不进去（T0-1 的死路）。
  现在只对「带托管块的补丁」硬断言 v3 + balance 两行、并检查同一预设不重复；自加行只提示不判失败。
- **`check-preset-compat` 的冻结 id 必须是源定义**：以前只看「仓库里某处出现过」，于是删掉
  `presets/flash-lean-ptc-v3-balance.patch.yml` 之后，陈旧合成产物里的那一行仍能让闸门放行。现在要求冻结 id
  出现在 `presets/*.patch.yml` 源文件里。
- **`selftest.sh` 增 8 项升级路径断言**（47 项）：只有自加行的补丁要过 `verify-yaml`、旧 `-lite` 补丁升级后必须是
  3 行且 `order: 99`、全新安装只能 2 行、插件卡已装时脚本必须 `exit 4` 而 `--force` 可叠加。
- **审计索引随包发布**：`docs/审计索引-0.2.9.md` 进 `files`（`npm pack` 实测 39 个文件）。
- **npm 发布准备**：`npm publish --dry-run` 通过（39 个文件；体积与 shasum 以该命令输出为准，文档不抄死，`prepublishOnly` 的
  `verify` + `selftest` 全跑），发布后需补 `node scripts/sync-published-version.mjs`（`publishedVersion` 0.2.8 → 0.2.9，
  它是 `lint-presets.mjs` 的「可引用已发布版本」白名单）。
- 校验与文档口径同步：`verify-presets` / `verify-yaml` / `verify-runtime` / `doctor` 的现役 id 表、`compose-bundle-patch`
  的注释、安装器默认预设、CI 的 id 断言都跟着改；版本号统一到 0.2.9（`package.json`、`package-lock.json`、
  `marketplace/plugin.json`、两个安装器的自检提示、两份 README）。

### 为什么是「全部映射」而不是「只映射规则相同的」

0.2.8 时期的口径是「规则相同才映射，规则不同就让它 not-found」。第五轮审计指出这本身就是一个回归：0.2.8 能打开的
v1/v2 会话，0.2.9 打不开了 —— 对用户来说「会话丢了」比「规则变了」严重得多，而且规则变化是可逆的（自己在补丁里加行），
会话打不开是不可逆的体验损失。所以：

1. **打得开优先**：所有历史 id 都进别名表，映射到 canonical。
2. **变化必须可见**：规则不同的别名标 `rulesDiffer: true`，首次命中打 `[preset-alias] 注意：… 的规则与 … 不同`。
3. **发行包只留两张卡**：正式发布的 `flash-lean-ptc-v3` 与新增的 `flash-lean-ptc-v3-balance`，其余历史 id 不占卡片
   （不进 picker，也不随包发行）。
4. **正式发布的 id 永不变更**：改 id 等于让旧会话打不开（0.2.7 踩过）。

### 安装流程会不会动会话

不会，而且现在有断言。`install.sh` / `install.ps1` 里没有任何 `sessions` / `retarget` / `migrate` 相关调用；包没有
`install` / `postinstall` 钩子（只有 `prepack` / `prepublishOnly`）；插件启动只把 `resolve/retain/acquireScope/readDocument`
`/mount/select` 换成「先按原 id 解析、失败才用 canonical 重试一次」的包装函数（纯内存），`mount` / `select` 还会先用
`service.definitions` 确认那个 id 到底有没有定义 —— 用户自己维护的同名预设不会被劫持。CI 里有一条 step 把装前装后的
`sessions/` 校验和逐字节比对。

### 测试

- `npm run verify` 退出码 0（输出 129 行 ✓、0 行 ✗）、`selftest.sh`（47 项）、`selftest-integration.sh`（17 项）、
  插件测试（26 个测试文件全过）全绿。行数与项数会随手加检查而变化，以脚本输出为准。
- 临时 `DSH_HOME` 里 `dsh web --port 0` 起一次宿主：日志出现 `[preset-alias] 已启用 5 个历史 preset id 的解析兜底`
  与 `（resolve/retain/acquireScope/readDocument/mount/select）`，两张卡都注册通过（没有 `agent-preset/invalid`），
  并且自检把 `flash-lean-ptc-v3-lite` 解析成了 `flash-lean-ptc-v3`。
- 安装后 `dsh --profile web --dump-config` 出现 `id: preset-flash-lean-ptc-v3` 与 `-balance` 两条；别名表 5 个 id 逐一
  解析到 `flash-lean-ptc-v3`。
- **A/B 复现**：把同一个桌面端会话文件分别对着 0.2.8 与 0.2.9 的 roster 跑 `scripts/audit-compat.mjs`，0.2.8 判为
  `orphan`（打不开），0.2.9 判为 `defined` / `aliased`（可解析）。本机全部 1007 个桌面端会话里，孤儿 id 一开始是 284 个
  （`flash-lean-ptc-v3` 281 + 私有 id `flash-lean-ptc-v3b` 3）。
- **本机最终口径**（包内两张卡 + profile 层自加的 `v2` / `v3b` / `v3e` 三行）：桌面端 1007 个会话 `defined` 505、
  `aliased` 0、`orphan` 0；WSL 1899 个会话 `defined` 449、`aliased` 363（`-lite` 340 + `flash-lean-ptc` 15 + `flash-lean` 8）、
  `orphan` 8（`code` / `win-control`，是更早的别的预设，未处理）。三个自加 id 只在本机 profile 补丁里，不随包发行。

## 0.2.8（2026-11-06，发布）

第三轮第三方审计（对象 `ad5ea0c` / `9c5117e`）的修正版。**npm 跳过 0.2.7 直接发 0.2.8**：0.2.7 有一个卸载回归，
装上它再用 `--uninstall` 会让 profile 起不来（见第一条）。本版**不改预设规则文本、不改模型行为**。
发布后按作者要求做了一次标签移动（`801d49a` → 第四轮审计的修正提交），GitHub 上的 `v0.2.8` 与 npm 上的 0.2.8
是同一份代码，Release 附件已同步重打；移动的做法与原因写在该 Release 的说明里。

### 修掉的

- **卸载把补丁写成空文件，profile 起不来（0.2.7 引入的回归）**：`--with-runtime` 装过之后 `--uninstall`，
  `tune-runtime --revert` 撤块时把末行 `[]` 一起带走，标准 profile（注释头 + `[]`）卸载后只剩注释，
  DSH 报 `... must be a top-level YAML array of loader patch entries`。两处一起改：①卸载顺序改成**先撤运行时块、
  再删托管块**（`install.sh` / `install.ps1`），②`--revert` 在剩余内容只剩注释/空行时补回 `[]`。
  实测三种形态（标准注释头 + `[]`、纯 `[]`、纯注释）卸载后 `dsh --dump-config` 全部退出 0，标准形态逐字节还原。
- **Windows `-Uninstall` 不撤运行时覆盖**：`install.ps1` 补 `Revert-Runtime`，卸载时先撤块再删托管块；
  `check-ps1` 增加静态断言（原来只比对文案，所以这条两轮都没抓到）。
- **`tune-runtime.mjs` 静默忽略不认识的参数**：`--apply -Profile web`（PowerShell 风格）会让它把
  `persistent-in-memory` 写到该 `DSH_HOME` 下**每一个** profile。现在不认识的参数直接退出 2；`install.ps1` 的提示改成 `--profile`。
- **`doctor`**：第 3 节只判定现役两个预设（历史 id 不再被说成「由组合包 dsh-flash-presets 提供」）；
  第 6 节在脚本安装的 profile 上不再让人 `add <裸包名>`（那会与托管块里的两行叠加成重复注册，也可能装到旧版），
  改成「先 `--uninstall`、再按 tag 装」；发现问题时退出码 1（新增 `--warn-only` 保留旧的只看输出用法）。
- **`install.sh --help` 末句被截断**：改成打印到 `set -euo` 之前，以后改头部注释不会再越界。
- **`loadAliasMap()` 真的跳过 `$` 开头的键**（`$comment` 一类元数据），`DSH_FLASH_PRESETS_ALIAS_EXTRA` 指向的文件同样处理 ——
  0.2.7 的变更日志写了这句，但代码里当时没有。
- **发布与版本检查**：`publish.sh` 删掉 `ALLOW_TAG_MOVE` 逃生阀（它没有约束力：脚本的 push 不带 `-f`，开了阀也推不上去），
  改成查不到远端标签就 fail-closed；`publish.ps1` 补上同样的闸；两个发布脚本的附件改成 `git archive "$TAG"`（原来打 `HEAD`）。
  `verify-versions` 新增「安装器 / marketplace / 两份 README 里写死的版本必须等于 `package.json`」。

### 测试

- `selftest.sh` 新增 `--with-runtime` → `--uninstall` 往返用例（标准补丁、`[]`、纯注释三种），断言卸载后文件能被
  js-yaml 解析成数组；装了 `dsh` 时再跑一次 `--dump-config`，要求退出 0。
- `selftest-integration.sh` 改用新参数名 `--with-runtime`，并断言 `doctor` 有 problems 时退出码非 0。
- CI 的 `pack-doctor` 去掉 `|| true`，改为断言「不崩 + 第 7 节出现兼容层说明」；`check-ps1` 增加「卸载里必须调
  `tune-runtime --revert`」「不得把 `-Profile` 传给 tune-runtime」两条静态断言。

### 文档

- README / EN：补上「常驻 PTC 运行时也是 profile 级、只能卸卡关闭」（原来只写了两项）；安装命令改成
  `dsh-flash-presets@0.2.8` 并保留 tag 形式；删掉重复的 npm 警告；`已知限制` 里那句自相矛盾的括号挪正。
- `版本与兼容性.md`：补丁层那句改为「两个预设行 + 一行计划模式组件」；「真机」改为「沿用 0.2.6，预设未变」。
- `marketplace/plugin.json`：英文描述把 lite / balance 说反了，改正；`install` 改成 npm 形式并钉版本，删掉会过时的 `note`。
- `plugins/plan-mode-ui/NOTICE.md`：补上游 MIT 声明。
- 本文件：同日迭代的 `0.2.14 … 0.2.7` 改名为 `0.2.6-iter14 … 0.2.6-iter7`（历史上同一天存在第二个「0.2.7」）；
  并订正 0.2.7 一节里 3 处与实际不符的说法。

### 第四轮全量审计（2026-11-06，并入同一版）

作者自审（1 P1 / 7 P2 / 13 P3）后合并修复，仍以 0.2.8 发布：`v0.2.8` 标签从 `801d49a` 移到本节所在提交，
Release 说明里记了这次移动，zip 附件也按新标签重新打包覆盖（文件名不变，sha256 变了）。

- **P1 · `lib/compat-heal.js` 的帧切分改成按 zstd 帧头逐块走**（等价上游 `scanZstdFrames`）。原来靠扫 magic 字节：
  压缩数据里出现同样的 4 个字节就会切错帧，改写后 DSH 读会话会报 `corrupt Zstandard session log: invalid frame magic`。
  校验也从「比切片字节」（用的是同一套偏移，切错了自己也跟着错，属于自证）改成**逐帧解压比文本** + 首帧必须是改写后的 header；
  末尾帧不完整就整份不动。拿 6 个真实会话实测：首帧改写成功、其余帧文本完全一致、二次运行 healed=0。
- **`lib/index.js` 写 `sessions.json` 原来没有锁**：与 `state.json` 共用一套跨进程锁（`withLock`），临时文件名带 pid。
- **`lib/tool-concurrency.js` 的 500ms 兜底扫描改成前 60 秒快扫、之后 5 秒一次**（新会话有 `agent/created` 事件即时补标，
  不必永久全量扫）；定时器句柄换成 `Set`，卸载时清空。
- **`doctor` 补 `--help`**（列出参数与退出码口径）；`merge-presets.mjs` 的错误提示不再推荐 0.2.6 就删掉的 `--legacy`。
- **README / EN 的「重复注册」说法按实测改写**：两条路径都装不会报错（`--dump-config` 仍退出 0），只是每个预设出现两张卡；
  `agent-preset/invalid` 是**预设定义解析失败**的错误码，不是重复注册。
- **Windows `-DshHome X -WithRuntime` 把运行时覆盖写进真实用户目录**（新 CI 用例一跑就抓到）：`-DshHome` 只是脚本参数，
  子进程 `tune-runtime` 读的是 `$env:DSH_HOME`，两者不同步时它会去改 `%USERPROFILE%\.dsh`。现在 `install.ps1` 解析完 `-DshHome`
  就同步到 `$env:DSH_HOME`，`check-ps1` 增加静态断言。
- **CI**：`verify.yml` 补 `concurrency`（同分支取消旧运行）；Windows 增加 `install.ps1 -WithRuntime` → `-Uninstall` 往返用例
  （此前 `-WithRuntime` 分支从未在 CI 跑过）；`npm-downloads-badge.yml` 的 node 从 20 改 24。
- **小项**：`scheduleCompatHeal()` 的守卫改成 `!== '1'`（原来只在 `=== '0'` 时返回，直接调用会绕过「默认关闭」）；
  `tune-runtime` 新增 `--no-backup`，两个安装器调用它时都传（原来每装一次多两个 `.bak-tune-*`），
  并在装卸结束时把这两类备份裁到最近 10 个；`--all-presets` 写进 `install.sh --help`；`package.json` 补 `author`；
  README 补 `DSH_PLAN_TODO_SYNC` / `DSH_PLAN_LAG_TURNS` 两个环境变量。

### 仍未做

- 需要改模型行为的：`tool-presentation` → `tool-executor-ptc`、规则 4 跨平台写法、两个预设的 description 中性化、
  并发标记与 runtime 覆盖收窄到本包预设、日志噪音与轮询间隔（进 0.3.0）。
- 锚点检查对 `docs/` 内部链接、重名标题、代码块里的 `#` 仍有盲区（现状实测没有失效链接）。
- 主基准出处两套口径（README 写 n=5 / 8 题，技术文档写 n=3 / 12 题）待作者确认哪一份对。
- 非标准结尾的补丁文件（末尾多空行、或缺末行换行）卸载后仍不保证逐字节还原；标准注释头 + `[]`、纯 `[]`、纯注释、CRLF 都能还原。

### 发布收尾（2026-11-06）

- npm 已发布 `0.2.8` 并成为 `latest`（`gitHead` = `336d996`，与 tag 一致；38 个文件 / 解包 554 878 B）；
  `package.json` 的 `publishedVersion` 同步为 0.2.8（该字段记录「已上 npm 的版本」，与本仓库当前版本区分）。
- **0.2.5 没有打 `deprecated` 标记**，这是作者的明确选择：账号 `tfa.mode = auth-and-writes`，废弃标记属于写操作，需要一次性验证码；
  而收益有限 —— `latest` 已是 0.2.8，`npm i dsh-flash-presets` 默认装到的就是修好的版本，只有显式钉 `@0.2.5` 的人受影响，
  且 README 与安装说明都指向 0.2.8。**订正（2026-11-07）**：这条标记后来确实补了 —— `npm deprecate` 已对 `0.2.2`–`0.2.5` 生效，文案是「0.2.5 在 DSH 0.2.2-rc.1 上无法新建会话，请用 0.3.0」（`npm view dsh-flash-presets@0.2.5 deprecated` 可复现）；原文说的 Automation token 已随 npm 收紧 bypass-2FA 一并失效，不要再依赖它。
- 顺带收紧了 `lint-presets` 的版本号检查：只判**代码块里**的安装命令（照抄会踩空的那种），正文里的历史叙述（「0.2.5 那版有回归」）不再误报 ——
  原来把 `publishedVersion` 同步成 0.2.8 之后，0.2.6 一节里那句历史说明就把 CI 判红了。负例已验证：代码块里写 `npm i dsh-flash-presets@0.2.5` 仍会被拦。

## 0.2.7（2026-11-06，发布）

第二轮第三方审计（19 条新发现 + 36 条复核）之后的一天内修正。这一版**不改预设规则文本、不改模型行为**，只改文档口径、安装器行为、包内容与 CI；因此不需要重测预设效果。

- **版本号**：0.2.6 一晚被 `git tag -f` 移过 5 次（702472b → a8f041b → efff2d8 → 2a337ad → ed68fc9 → 8f069d9），同一个「0.2.6」对应过 6 个提交。`v0.2.6` 自此冻结在 `8f069d9`，本版是干净的 0.2.7；`scripts/publish.sh` 增加硬规则：远端已有同名 tag 就拒绝执行。
- **安装器**（N1-3 / N2-2 / P2-11）
  - 完成提示重写：明确「已写入两行预设」「计划模式组件、旧 id 兼容层、`glob`/`grep` 并发只在插件管理器安装时才有」「两条路径二选一，切换前先 `--uninstall`」，删掉自相矛盾的「运行时调优已就位」与会装到坏 0.2.5 的 `add dsh-flash-presets` 建议。
  - `--with-plan-mode` 更名 `--with-runtime`（旧名保留为别名）：它只写 profile 级 `ptc-runtime: persistent-in-memory`，不装计划模式组件；帮助文本、注释、示例 profile 一并修正。
  - `--uninstall` 现在会一并撤掉 `--with-runtime` 写入的 `# >>> tune-runtime` 块（`tune-runtime.mjs` 新增 `--revert`），不再出现「卸完整个 profile 仍被改着」。
    > **订正（0.2.8）**：这条在 0.2.7 上只对 bash 成立（Windows 的 `-Uninstall` 到 0.2.8 才撤），而且顺序错了 —— 先删托管块再撤运行时块会把末行 `[]` 一起带走，`--with-runtime` 装过再卸载的 profile 起不来。0.2.8 修。
  - `tune-runtime.mjs` 尊重 `DSH_HOME` 的两行缩进修正。
- **doctor**（N2-1）：旧会话扫描器不随包发布，`--sessions` / `--all` 在插件安装形态下不再 `ERR_MODULE_NOT_FOUND`；改为只读说明「旧 id 由兼容层解析，会话无需迁移」，并删掉会改写会话的 `--apply` 建议。
- **alias 表**（N3-1）：`$comment` 从 `aliases` 移回顶层，计数类输出不再多 1。
  > **订正（0.2.8）**：「`loadAliasMap()` 跳过 `$` 开头的键」这句当时写错了 —— 代码里没有这段逻辑（只把 `$comment` 挪出了 `aliases`），0.2.8 才补上。
- **peer 范围**（N3-2）：`@deepseek-ai/dsh-llm` 改为 `>=0.2.1-rc.5 <0.2.3-0 || >=0.2.2-0 <0.2.3-0`——原来那条在 npm/pnpm 的严格 semver 下不含 0.2.2-rc.1（DSH 自己的 `engines` 判断用 includePrerelease，不受影响）。
- **NOTICE**（N3-3）：版权行照抄上游（`Copyright (c) 2026 DeepSeek`），附上游 MIT 全文，并加本包版权行。
- **文档口径**（P1-7 / N2-3 / N2-4 / N2-5 / N2-8 / N2-9 / N3-4 / N3-5 / P2-5 / P2-6 / P2-8）
  - README 顶部不再声称「不动共享工具注册表」：如实写出对整个 profile 生效的两项与关闭开关（`DSH_FLASH_PRESETS_CONCURRENCY=0`、`DSH_FLASH_PRESETS_ALIAS=0`）。
  - 「12 个历史 id」→「5 个本包发布过的历史 id」并给出名字；`DSH_FLASH_PRESETS_ALIAS_EXTRA` 作为个人映射入口。
  - 失效锚点（`#已知偏差` / `#known-deviations`）与悬空的 P15654 引用修掉；`verify-presets` 现在检查 `#` 锚点并覆盖 `README.en.md`。
  - 计划模式「full 贵约 26%」改为按中位数算的 17%（40.2 k vs 34.3 k，196 s vs 147 s）；规则数实验写成「最多四臂」。
  - `docs/版本与兼容性.md` 重写：删掉「一张卡三个组件 / 兼容别名 / 三条 insert / `@0.2.6` / 回退装 0.2.5」整节，headless 与 acp 的结论分开写，体积与文件数改成现查命令。
  - `marketplace/plugin.json` 落后两版：描述、兼容区间、安装命令按 0.2.7 重写。
- **CI**（P1-11 / N3-7）：`bundle-install` 加 `0.2.1-rc.5` 与 `0.2.2-rc.1` 两档矩阵，断言改为精确 id 比对（原来 `grep flash-lean-ptc-v3` 是子串匹配，等于什么都没断言），步骤名同步；新增 `pack-doctor` job：`npm pack` → 解包 → 在解出来的 38 个文件里跑 `doctor --all` / `tune-runtime` / `verify-presets`，并断言写会话的维护脚本没有随包发布。

- **`install.sh --help` 把正文打了出来**：头部注释改短后 `sed -n '2,19p'` 会把 `set -euo pipefail` 一起打印，改为 `2,16p`。
  > **订正（0.2.8）**：这一处是 0.2.7 首发之后补的。`v0.2.7` 实际移动过两次，真实路径是 `f414cad`（20:56）→ `ad5ea0c`（21:03）→ `9c5117e`（21:13），两次都在 CI 全绿之后才移（间隔 7 分钟和 10 分钟，不是「约半小时」；原文里的 `deb3228` 从未挂过这个 tag）。`v0.2.7` 最终冻结在 `9c5117e`，npm 跳过了这一版。原文提到的 `ALLOW_TAG_MOVE=1` 逃生阀已在 0.2.8 删除：它其实没有约束力（脚本的 push 不带 `-f`），真正能拦住移动 tag 的是 GitHub 的 tag 规则集。
- **发布模拟发现的两处误报**（`npm pack` → 全新 profile 安装 → 跑用户侧脚本时才暴露）：`doctor` 用 `id: flash-lean-ptc-v3\b` 匹配，`\b` 会在 `-v3-lite` 前成立，于是把三个 id 算成一个、并把历史 id 误报成「出现在合成配置里」；`verify-presets` 在装出来的包里断言 `scripts/publish.sh` 存在，而发布脚本本来就不随包发布。前者改成精确整行匹配，后者只在仓库里检查。
- **仍未做**（需要改模型行为，另行排期）：`tool-presentation` → `tool-executor-ptc`（`dsh-tool-executor-ptc` 在 0.2.1 系列里不存在，换它等于放弃 0.2.1 下限）、规则 4 跨平台、两个预设的 description 中性化、并发标记只作用于本包预设（目前对整个 profile 生效，已在文档如实说明）、日志噪音与轮询间隔。
## 0.2.6（2026-11-06，发布）

- **发布前修正：DSH 0.2.2-rc.1 下两张「Agent 预设」卡片显示「加载失败」**（本机实机复现并修复）
  - 现象：GUI「设置 → Agent 预设」里 `轻量PTC-v3 lite` 与 `轻量PTC-v3 balance` 都带红标「加载失败」；`agentPresets/list` 的 `broken` 为 `tool-subagent-list-agents (@deepseek-ai/dsh-tool-subagent-control/list-agents): never started`，新建会话用不了这两个预设。
  - 原因：两个预设都声明了 `- id: tool-subagent-list-agents` / `name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'`。DSH 0.2.2-rc.1 把 `list_agents` 并进 `@deepseek-ai/dsh-tool-subagent-control` 主插件，`exports` 只剩 `"."`，子路径 `./list-agents` 已不存在；该行 import 失败，**整份预设**被判 broken。0.2.1-rc.x 上这行有效，所以在旧版本上测不出来。
  - 修法：两份 `presets/*.patch.yml` 删掉这个两行条目（`list_agents` 由 `tool-subagent-control` 主插件自带，能力不减），重新合成 `cordis.patch.yml`；`verify-yaml.mjs` 增加断言，禁止再出现该子路径。
  - 验证：`desktop` profile 实机安装后，用一次性诊断插件调 `agentPresets.list()`，两个预设均无 `broken`；`--dump-config` 本包预设行 2 条、`persistent-in-memory` 1 处、`plan-mode-ui` 1 处。
- **升级注意（0.2.5 → 0.2.6）**
  - `flash-lean-ptc-v3` 不再作为独立预设定义：旧 id 由运行时兼容层解析，按 id 恢复的历史会话**无需重选**；但 `agent-preset-registry` 的 `selectedDefault` 若仍指向旧 id，**仍需手改**（alias 只兜底解析，不改 profile 配置），否则新建会话报 `Unknown agent preset: flash-lean-ptc-v3`。
  - `flash-lean-ptc-v3-lite` 的语义变了：0.2.5 时期它是 3 条规则的弱约束版，0.2.6 起是 13 条规则的默认版；原来的 3 条版本改名为 `flash-lean-ptc-v3-balance`（order 26）。
  - `desktop` / `headless` / `acp` 只在启动时读补丁层，装完必须完全退出再启动；`web` 刷新页面即可。替换后卡片仍然红，说明还有别的行不匹配，按上面 `broken` 字符串的格式继续排查。
  - 自定义预设时不要写 `@deepseek-ai/dsh-tool-subagent-control/list-agents`：DSH 0.2.2 起该子路径已移除，写了会让整份预设失效。

- **预设重命名为两个，语义按「约束强度」重新排列**：
  - `flash-lean-ptc-v3-lite`（显示名「轻量PTC-v3 lite」，13 条规则，order 27，**默认**）：原 `flash-lean-ptc-v3` 的自由精确改名，描述改为「效率最高的轻量预设，适用于绝大部分日常工作」。
  - `flash-lean-ptc-v3-balance`（显示名「轻量PTC-v3 balance」，3 条规则，order 26）：原 `flash-lean-ptc-v3-lite` 改名，描述改为「约束较弱的预设，适用于需要模型发挥的场景」。
  - `flash-lean-ptc-v3` 不再作为独立预设定义；旧 id 由运行时兼容层解析，按 id 恢复的历史会话无需重选（兼容层见下方 0.3.0）。
  - `v3-max`（7 条）与 `v3-none`（0 条）仍在 `presets/` 之外，只保留在评测协议 `arm-v3max.yml` / `arm-v0.yml` 里作对照臂。
- 依据：三床 × 四臂实测（决策 15 次/臂、hard 9 次/臂、算法 10 次/臂）显示 persona 规则条数对质量与 token 均无可测差异（配对比 0.86–1.42，Bonferroni 后无一显著）；同时长任务注意力评测里 v3 在长文阅读轴出现可判定退化（−4.00 [−7.60, −1.20]），故不做进一步削减，也不保留无人格对照组作为发布项。
- 校验脚本、安装器、doctor 与中英 README 改为两预设口径（`verify-runtime` 断言预设行数为 2）；**版本表当时没有同步**——仍是「一张卡三个组件 / 兼容别名 / 三条 insert」（见下文「第三方审计修复」P1-5 与本节末的措辞更正）。

### 发布验证（2026-11-06 晚：全新安装 + 同环境 A/B）

- **tag `v0.2.6` 的指向（如实记录）**：该 tag 在 2026-11-06 19:38–20:29 之间先后指向 6 个提交（`702472b` → `a8f041b` → `efff2d8` → `2a337ad` → `ed68fc9` → `8f069d9`），最终停在 `8f069d9` 并**已冻结，后续改动只进新版本号**。按 tag 安装的用户，锁文件钉住的是各自安装那一刻 tag 所指的提交——所以同一个名字 0.2.6 实际对应过 6 个不同提交；Release 附件也在 20:29 按 `8f069d9` 重传。
- **CI（提交 `8f069d9`，即 tag `v0.2.6` 最终指向的提交）**：`verify (ubuntu-24.04 / windows-latest / macos-latest)` + `integration` + `bundle-install` + `plugin-tests (22 / 24)` 全部 success（`canary` 只在每周 cron 跑，本次 skipped 属正常）。
  这之前从 `cf955ac` 起 CI **一直是红的**，原因是三处**过期断言**：① `selftest-integration.sh` 写死 `[7] dsh --dump-config`，而 doctor 新增「旧会话的预设 id」小节后该检查漂到 `[8]`；② `verify-runtime.mjs` 写死「预设行数 3」，而 0.2.6 只装 lite / balance 两个；③ `verify-versions.mjs` 要求 `dist/` 附件名带**插件版本**，与真实约定（组合包附件按 tag 命名，如 `dsh-flash-presets-v0.2.6.zip`）冲突。三处分别改为「按小节标题匹配」「从 `SHIPPED` 推导行数」「两类附件各按各的版本口径」。
- **全新安装（空 `DSH_HOME`）**：`dsh plugin --profile web add dsh-flash-presets-0.2.6.tgz` → `+1 package`、475 ms（pnpm 离线）。安装包内 `lib/{tool-concurrency,preset-alias,composition-check,compat-heal,index}.js` 与仓库 sha256 **逐个相同**；`--dump-config` 里 `ptc-runtime → executionMode: persistent-in-memory`、`preset-flash-lean-ptc-v3-lite` / `-balance` 各 1 行，`verify-runtime.mjs` 对该 dump 断言通过；把**安装包里的 `lib/`** 直接喂给插件测试：12 passed / 0 failed（含「executable 钩子：决策点即时标记（不依赖扫描）」）。
- **A 在新装里立刻生效**：启动即 `[tool-concurrency] 已启用（目标 glob,grep；全局视图 未注册；已挂载会话 0）→ 会话挂载预设后会补标记`；首个会话挂上后立刻出现 `已标记 glob,grep（全局视图 + 1 个会话作用域，共 2 处）｜调度器判据 glob=true grep=true（最近会话）` —— 不等任何定时扫描，决策点钩子按预期工作。
- **同环境 A/B（一步里三个 grep，同一句提示词）**：
  - A 开：`65949→68440(2491ms) / 65951→68447 / 65951→68450` ⇒ **并行**，跨度 2501 ms，各自之和 7486 ms（起始相差 2 ms，窗口完全重叠）。
  - A 关（`DSH_FLASH_PRESETS_CONCURRENCY=0` 重启同一 home）：`8624→11578(2954ms) / 11580→11942(362ms) / 11943→12147(204ms)` ⇒ **串行**，跨度 3523 ms ≈ 各自之和 3520 ms。
  - 结论：并发来自本插件（而不是 DSH 默认行为），且**新装第一轮就生效**。
- **复现**：隔离实例起在 3099（自带 `--patch` 只把模型指向本机 WB Proxy，不改安装内容），用带 token 的入口打开会话发同一句提示词，然后用本机私有的并发测量脚本（`measure-tool-concurrency.mjs`，不随包发布，参数 `--dsh-home <隔离 home>`）跑一遍。测量时看每批的 `⇒ 并行/串行` 结论，别只看脚本末尾那句汇总（只要存在任一并行批它就会打印「并发确实发生」）。
- 同版本其它校验：`npm run verify` 退出 0（含 `sync-lib --check`、`check-ps1`）；插件测试 25 项通过；四层对齐审计存储层 1622/1622、reject 0、无幽灵目录、`aliased 0 / orphan 0`；实机 DSH 0.2.2-rc.1（WSL）与 0.2.1-rc.5。

### 第三方审计修复（2026-11-06 晚，P0/P1/P2 处理）

审计报告共 36 条（P0 1 / P1 13 / P2 16 / P3 6）。本轮只处理**不改规则文本、不改预设行为**的部分；代码级改动另行排期（见本节末「未做」）。

- **P0-1（npm 上 0.2.5 在 DSH 0.2.2-rc.1 上无法新建会话）**：README 明确「npm 上的 0.2.5 不可用；0.2.6 上 npm 之前从 GitHub / Release 附件安装」，安装节首选 `dsh plugin --profile web add github:LarryE135/dsh-flash-presets#v0.2.6`。但审计建议的「脚本安装与插件卡安装**二选一**、切换前先 `--uninstall`」这两句**没有**写进 README（全文无「二选一」，卸载节也没有切换前先卸的说明），留给 0.2.7。npm 端仍需 `npm login` 后 `npm deprecate dsh-flash-presets@0.2.5 "DSH 0.2.2-rc.1+ 下预设无法加载，请用 0.2.6+"` 并发布 0.2.6（本机 token 已过期）。
- **P1-1 DSH 版本闸放错位置**：`engines` 原来嵌在 `dsh` 对象里，而 `dsh-app-boot` 只读**顶层** `fields.engines`（已核对该文件 1098-1102 行），等于没有任何闸。现改为顶层 `engines: { dsh: ">=0.2.1-rc.5 <0.2.3-0", node: ">=22.15" }`，`dsh.engines` 删除。
- **P1-2 peer 自动安装旧包**：`@deepseek-ai/dsh-llm` 从 `"*"` 收窄到同区间，并加 `peerDependenciesMeta.optional`（与 `plugins/plan-mode-ui/package.json` 一致），避免 `npm i -g` 拉进 2026-08 的 0.0.1-rc.1。
- **P1-5 预设数量/id 五处打架（部分完成）**：中英文 README 与 `cordis.patch.yml` 头注释模板统一为「两个预设：lite（13 条，默认）+ balance（3 条）；旧 id 由运行时 alias 解析，不建兼容卡」；**版本表没同步**——`docs/版本与兼容性.md:84-90` 当时仍是「一张卡三个组件」、`preset-flash-lean-ptc-v3（兼容别名）`、「补丁层里的三条 insert」，与 README 的两个预设正面冲突，留给 0.2.7 重写；删掉 README 里把 0.2.7–0.2.9 当成已发布版本的段落（改为指向本文件「同日迭代」）；删掉英文版里不存在的 `presets/flash-lean-ptc-v3-alias.patch.yml` 引用。
- **P1-6 计划模式安装说明三套说法**：统一为「计划模式与常驻运行时只有 `dsh plugin add dsh-flash-presets` 才装；`install.sh` / `install.ps1` 只写两行预设」。删掉不存在的包名 `dsh-plan-mode-ui` 及对应命令，两个安装器的完成文案同步。
- **P1-7 README 说「不动宿主」不成立（本轮未做）**：0.2.6 定稿时 README 顶部**没有改动**——当时的 `README.md:17` 写的是「不改宿主代码，也不动共享工具注册表」，与同页「插件在运行时为 `glob` / `grep` 补上只读并发标记」直接矛盾；三项全局生效说明与关闭开关 `DSH_FLASH_PRESETS_CONCURRENCY=0` / `DSH_FLASH_PRESETS_ALIAS=0` 当时也都没写进 README（全文只有 `DSH_FLASH_PRESETS_SELFCHECK_HEAL`）。该页在本文件定稿后已另行修改，不属 0.2.6。开关本身在代码里已有（`lib/tool-concurrency.js` / `lib/preset-alias.js`），缺的是文档；留给 0.2.7。
- **P1-8 alias 表泄漏本机实验 id**：`presets/legacy-preset-map.json` 只保留本包真实发布过的 5 个 id（`flash-lean`、`flash-lean-ptc`、`-v1`、`-v2`、`-v3`），移除 `code` / `win-control` / `codex-contract-v1` / `-v3b` / `-v3-1` / `-v3-max` / `-v3-none` 以及全部 `sessions` 计数与本机备注。个人 id 改用新环境变量 `DSH_FLASH_PRESETS_ALIAS_EXTRA=<json>` 追加，不随包发布。
- **P1-9 会话改写说法矛盾**：README 只保留「默认关闭，`DSH_FLASH_PRESETS_HEAL=1` 才开」；`files` 移除 `scripts/retarget-session-presets.mjs` 等会写会话的维护脚本（仍留在仓库）。
- **P2-1 根包缺 `type` / `engines.node`，CI 用 Node 20**：加 `"type": "module"` 与 `engines.node >= 22.15`；CI 的 verify job 从 Node 20 升到 24。