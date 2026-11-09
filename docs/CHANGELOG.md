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
- **P2-2 / P2-3 包体积数字过期、`files` 过宽（部分完成）**：README 里写死的文件数/体积已删（口径改为以 `npm view dsh-flash-presets dist.fileCount dist.unpackedSize` 为准），但**版本表当时仍写死**——`docs/版本与兼容性.md:82` 当时还写着「0.2.6 的 45 个文件 / 约 474 kB（压缩后约 161 kB）」，与实测 38 文件 / 171.7 kB 不符，留给 0.2.7；`files` 改为白名单这一半是真做了：benchmark / AB / 迁移 / 发布类脚本不再进包。
- **P2-4 / P2-5 description 自相矛盾（只做了 `package.json`）**：`package.json` 的 description 已按两预设口径重写；`marketplace/plugin.json` **本轮零改动**（`a8f041b..8f069d9` 对 `marketplace/` 无提交）——当时 `:5` 写着「v3 (13 rules) is the default; v3 lite keeps only the three rules」、`:6` 写着「（v1/v2/v3）……v3（lean-v3）为现行主版本」、`:23` 的兼容区间是 `dsh >=0.1.7-rc.1`，`install` 命令是裸包名。留给 0.2.7（该文件在本文件定稿后已另行修改，不属 0.2.6）。
- **P2-8 / P2-15 个人路径与账号页**：`docs/实测证据.md` 的复现命令改用 `$HOME` 并注明「私有脚本，不在仓库」；`PUBLISHING.md` 的 token 页改为通用链接。
- **P2-10 `tune-runtime.mjs` 忽略 `DSH_HOME`**：ROOT 改为 `(${process.env.DSH_HOME || ~/.dsh})/profiles`，隔离环境里跑安装器不再改真实 `~/.dsh`。
- **P2-16 上游署名**：新增根目录 `NOTICE`（声明预设 agent 树与 `lib/` 复刻/改编自 deepseek-ai/deepseek-harness，MIT），并加进 `files`。

**未做（需要改行为或改规则文本，留给下一个版本）**：P1-3（`dsh-agent-tool-presentation` → `dsh-tool-executor-ptc`，需先核实该包在 0.2.1-rc.5 是否存在）、P1-10（两个预设 description 的中性化措辞）、P1-11（CI 双版本矩阵 + mount 冒烟测试、canary 改每日）、P1-12（规则 4 的 `/usr/bin/time -v` 跨平台化）、P1-13（两套实测口径的原始数据补齐）、P2-12（启动日志合并、扫描频率下调）。P2-9（先发 Release 后 CI 变绿、tag 被移动）见上一节「发布验证」的记录：tag `v0.2.6` 当晚在 19:38–20:29 之间被移了 5 次、共指向 6 个提交，最终停在 `8f069d9`；**该 tag 已冻结，不再移动，后续改动只进新版本号**。

**本节措辞更正（2026-11-06 晚补记）**：上面几条当时只做了一半，原文却写成了已完成或已统一。补正后的事实是：① 0.2.6 定稿时 README 安装节改成了按 tag 安装，但没有审计建议的「二选一」与「切换前先卸载」；② `docs/版本与兼容性.md` 当时未同步（仍是「一张卡三个组件 / 兼容别名 / 三条 insert」，并写死 45 文件 / 约 474 kB；该页后来另行重写，不属 0.2.6 的改动）；③ 0.2.6 定稿时 README 顶部未动，也没有 `DSH_FLASH_PRESETS_CONCURRENCY=0` / `DSH_FLASH_PRESETS_ALIAS=0` 的说明（该页此后已另行修改，不属 0.2.6）；④ `marketplace/plugin.json` 在 0.2.6 定稿时零改动（中英文描述仍按 v1/v2/v3 口径，`compatibility.dsh` 仍是 `>=0.1.7-rc.1`；该文件后来另行修改，不属 0.2.6）；⑤ tag `v0.2.6` 当晚移动过 6 次（见上一节）。这五项都不是「已修」，留给 0.2.7 处理；本节不做任何未经验证的完成陈述。

### 同日迭代（未单独发布）

> 这里的编号是当天的迭代序号（`0.2.6-iterN`），**不是对外版本号**。正式发布过的是 0.2.6、0.2.7（仅 GitHub tag）与 0.2.8。

> 本节按时间倒序记录 0.2.7–0.2.14 的迭代，全部并入 0.2.6，从未单独发布。**0.2.9 未单独成节**：本次整理时仓库里找不到对应条目（只有代码注释提到它），内容待作者补充。

#### 0.2.6-iter14（2026-11-06，A 的实测验收：发现「第一轮赶不上扫描」的竞态，改成决策点即时标记）

- **现场实测（真跑）**：在 GUI 里新建会话、同一轮发 3 个 grep（`path` 都是本仓库，`pattern` 分别是 `preset-alias`/`composition-check`/`tool-concurrency`），从会话日志取 `tool/call → tool/result` 时间窗：
  `18:53:17.880→.920 / .920→.942 / .943→.962` —— **首尾相接，串行 82ms**，不是并行。
- **根因是竞态，不是标记无效**：该会话 18:53:12.790 才 `agent-preset/selected`，18:53:16.044 开轮，18:53:17.88 三个调用就发完了；而 0.2.13 的补标记**只有 15s 定时扫描一条路径**，最近一次扫描发生在会话挂载之前 → 那一轮里 `glob`/`grep` 还是「没声明」的原始定义，`executionMode()` 按 exclusive 串行。换句话说：**A 只对「挂载超过 15s 之后」的轮次生效**，而人打开会话后通常几秒内就发第一句。
- **修法一（决定性）：在决策点挂钩**。pipeline 取工具定义走 `ctx.tools.executable(name, scope, toolSet)`（`pipeline.js:261`，`this.tools = ctx.tools`，原生执行器不带 `source.get`），于是包住 `executable()`，目标名（默认 `glob`/`grep`）返回前若还没标记就补上——调度器问「能不能并行」时一定已经带上标记，与定时扫描无关。只标记未声明的（上游自己声明则原样保留），异常全部吞掉，卸载时还原 `executable` 并撤掉「顺手」打上的标记（`Symbol.for("dsh-flash-presets.tool-concurrency.hook")` 防重复安装）。
- **修法二（兜底）：扫描间隔 15s → 500ms**（`toolConcurrency.sweepMs` 可调），并订阅 `agent/created`，新会话挂载时立刻标一次。
- **日志改成「按作用域增长各打一条」**（以前只打首次）：每多标住一个会话就多一行 `已标记 glob,grep（全局视图 + N 个会话作用域，共 M 处）｜调度器判据 glob=true grep=true`，方便事后核对「标记是否先于那一轮」。幂等，不刷屏。
- **测试** 12 项（新增 2 项）：`executable` 钩子在**决策点**即时标记（扫描间隔故意设成 10 分钟，证明不依赖扫描）、非目标工具不受影响、卸载还原；日志随作用域增长（+1 会话 → 多一条且显示 `+ 2 个会话作用域`）。
- **顺带修正 0.2.13 的文档口径**：0.2.13 条目里「按 500ms/1s/2s 退避重试（默认 4 次）」与 `toolConcurrency.attempts` 是早期设计的残留，实际发布的是「全局 + 按 agent 作用域扫描」这一版，本次一并改正。
- **验收方法**（重启后）：新开会话发同一轮 3 个 grep，然后用本机私有的并发测量脚本（`measure-tool-concurrency.mjs`，不随包发布；参数 `--session <id片段> --name grep`），应显示 `批 [3] … ⇒ 并行`（跨度 < 各自耗时之和）；对照组把 `DSH_FLASH_PRESETS_CONCURRENCY=0` 打开重启，同样跑一次应显示 `⇒ 串行`。

#### 0.2.6-iter13（2026-11-06，run_code 优化 A 真正落地：不再改 node_modules，改由插件在运行期给 glob/grep 补并发标记）

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

#### 0.2.6-iter12（2026-11-06，对齐审计：四层一次扫完；修掉 0.2.11 记下的路径 bug）

- **新增 `scripts/audit-align.mjs`**（`npm run audit:align`）：一条命令扫完四层，回答“为什么看起来还没对齐”。① 存储层按 DSH 自己的选取规则（同一会话目录只认世代号最大的日志）复核世代文件名 ⇄ `header.version`、"id/cwd → 目录路径" 的身份一致性与幽灵目录；② 解析层列 roster/alias/orphan；③ 记录层列“仍然写着历史 id”的会话（这些会话解析没问题，但头部芯片按 roster 查不到名字，会显示原始 id）；④ 组合层列“实际会跑哪个预设”，并区分“记录为空”的会话。退出码：存储层不变量被破坏或出现孤儿 id 时为 1。
- **修正 0.2.10 的一处误读**：`audit-compat` 把“没有记录 preset”的 1072 条会话算成“实际跑 selectedDefault”。实测这 1072 条全部来自自动化/实验运行（本机私有试验目录与 `/tmp` 一类临时目录，多为 700+ 事件的跑批；这些目录与脚本都不随包发布），它们的组合由调用方的 profile 决定，不受 web profile 的默认值支配；真正吃 `selectedDefault` 的是**新建**会话。因此把 profile 默认值改成 lite 只影响新建会话，不能用来“修”这些老会话。
- **修掉 `sessionHeader()` 的路径拼接 bug**（0.2.11 结尾“留待单独评估”的那一条）：DSH 的会话 id **自带 `session-` 前缀**（`workspace.json`、`session.lock`、header 里都是这个形式），目录名就是这个 id；旧代码又拼了一次 `"session-" + id`，得到 `session-session-…`，于是兜底读盘永远落空，`delegationDepth` 恒为 0、`isSubagent()` 恒为假。现在两种写法都试（与 `composition-check` 的取样口径一致），命中后仍走同一份 30 秒失败节流缓存。
- **`retarget-session-presets.mjs` 与 DSH 的选取规则对齐**：以前它对同一会话目录里**所有**世代日志都做分析，于是同一个会话可能在报告里出现两次、备份里多出一份永远读不到的旧世代；现在只处理世代号最大的那份（与 `audit-align` 同口径），并在摘要里报出“历史世代文件（不动）”的条数（本机 274 份）。待改写会话数因此从 193 变成 162（193 里含 31 份历史世代文件）。
- **本机审计结论**（WSL，1622 个会话）：存储层 1622/1622 通过（0 世代不匹配 / 0 身份不匹配 / 0 幽灵目录 / 0 旧扁平布局；另有 274 份历史世代日志、182.6 MB 被正确忽略）；解析层 orphan 0（162 条走 alias）；记录层 162 条仍写历史 id（48 条在侧栏 → 芯片显示 `flash-lean-ptc` 之类的原始 id）；组合层 1072 default / 334 lite / 183 standard / 19 minimal / 12 ptc / 2 balance；侧栏可见 268，有内容但无 `session/title` 的 157 条（首次打开时由 DSH 回填）。

#### 0.2.6-iter11（2026-11-06，组合自检：热重载后的「压缩/计划消失」不再靠人发现）

- **现场**：0.2.10 装好并重启后，17:31–17:44 之间打开的 **22 条**会话，其 agent 的预设组合层（tool executor / compaction / command-compact / command-goal / plan-mode）在 17:48:21 一次插件热重载中被连同旧插件图 dispose 掉，且不会自动重挂。用户看到的是斜杠菜单只剩 profile 全局命令（`export`/`feedback`/`permission`），「压缩 compact」「计划 plan」「目标 goal」全没了；再发一句就报 `The selected tool executor is unavailable. Load an executor in this composition before running the agent.`。会话日志、预设定义、alias 层全都正常——**纯运行期状态**，重启 dsh 即恢复（实测 22/22 恢复）。
- **新增 `lib/composition-check.js`**：激活后等 `agents`/`commands` 就绪，每 2 分钟（可调）扫一遍**已挂载** agent，用两个只读探针判定组合是否还在：`commands.list(agent)`（期望命令默认 `compact`，可用 `DSH_FLASH_PRESETS_SELFCHECK_EXPECT` 改）与 `tools.selectExecutor(agent)`（纯查找，缺失时抛 `ToolExecutorUnavailableError`）。任一失败即打一条错误日志，写明「命令层 = …、缺 compact/、工具执行器不可用」和处置（重启 dsh / 重选预设）；同一会话不重复刷屏。
- **可选自动重挂**（默认关）：`DSH_FLASH_PRESETS_SELFCHECK_HEAL=1` 时，从会话首帧读 `agentPreset`，调一次 `agentPresets.select(agent, id)`，随后复验命令层。**这一步会往会话日志写一条 `agent-preset/selected`**（等同用户在选择器里点一下），所以默认关闭，只在明确想自救时开。
- 开关与配置：`DSH_FLASH_PRESETS_SELFCHECK=0` 整体关闭；cordis 配置 `compositionCheck: {enabled, expect, intervalMs, heal}`。定时器走 `ctx.effect`，插件卸载即清；所有异常只记一条日志，绝不影响宿主。
- **测试** `plugins/plan-mode-ui/test/composition-check.mjs`（26 项）：健康不报警、只剩全局命令报警一次且不刷屏、仅执行器缺失也报警、heal 降级路径（读不到 preset 时不写日志地放弃）、heal 成功路径（临时 DSH_HOME + 真多帧 zstd 首帧 → 真调 select → 复验恢复）、服务缺失/list 抛错/无 id 的容错、开关与 expect 解析。
- 顺带修正：会话目录名就是会话 id（`session-<uuid>`），新模块按此解析；`lib/index.js` 里旧有的 `sessionHeader()` 用 `"session-" + id` 拼路径，对真实 id 永远落空（只是被兜底掩盖），本次未动它，留待单独评估。

#### 0.2.6-iter10（2026-11-06，旧会话的根因修复：id 是持久化契约，不是显示名）

- **根因**：DSH 把 preset id 写进会话日志（首帧 `header.agentPreset`，以及每条 `agent-preset/selected` 事件），`resume` 时用 `agentPresets.resolve(有效 id)` 解析，解析不到就抛 `agent-preset/not-found`。上游没有 alias / hidden / fallback 字段（definition 只有 id/name/description/order/plugins），picker 只过滤 `broken`——所以**改名或删除 id 等于把旧会话弄丢**。0.2.6 删 `flash-lean-ptc-v3`、0.2.9 又删 `-v3-lite` 以外的兼容卡，都是同一个错误的两次发作。
- **新增运行时 alias 层** `lib/preset-alias.js` + `presets/legacy-preset-map.json`（12 个历史 id → `flash-lean-ptc-v3-lite`）：只在解析失败时回落一次；不新增 preset 定义、不进 picker、**不写任何会话文件**；方法不存在/签名变化/赋值失败一律静默退化；`ctx.effect` 卸载即还原；`DSH_FLASH_PRESETS_ALIAS=0` 可关。
- **启动自愈改为 opt-in**（`DSH_FLASH_PRESETS_HEAL=1`）：有了 alias 层就不需要在启动时改写用户数据，而启动改写会话正是 0.2.6 截断事故与 0.2.9 误判的同一类动作。
- **修掉审计口径错误**：`scripts/audit-compat.mjs` 原来只看 header，于是「header 已修好、事件里还写着旧 id」的会话被判成健康——本机 193 个打不开的会话就是这么被漏掉的。现在按 DSH 自己的语义判定（有效 preset = 最后一条 `agent-preset/selected`，没有才是 header），roster 也从 `dsh --profile web --dump-config` 取（扫目录会把别的 profile 与 `.bak-*` 算进来，曾把 `codex-contract-v1`/`-v2` 误判成“已定义”）。实测：WSL 1894 个会话 → 193 个经 alias 可解析、0 个孤儿；Windows 1007 个 → 6 个经 alias、0 个孤儿。
- **新增一次性迁移工具** `scripts/retarget-session-presets.mjs`（默认 dry-run）：只改「决定解析结果的那一处」（最后一条 selection，或 header），**帧级改写**、其余帧按字节拼接，首帧仍必须是一行 header；写前整份备份 + manifest，写后两遍独立校验（逐行语义比对 + 从磁盘重读确认无残留旧 id），失败即回滚；同步清理 `storages/session_projcache` 对应条目（缓存按 seq 续算，不清就会一直沿用旧值——这是 0.2.8 自愈“跑了但没生效”的原因）。沙箱实测：21 个真实会话样本 → 改写 19、失败 0、第二遍 0 改写（幂等）、`--revert` 后与 pristine 逐字节相同。
- **兼容闸门** `scripts/check-preset-compat.mjs` 接入 `npm run verify`：历史 tag 里的 id 必须三选一才算通过——当前仍定义 / 在 alias 表里 / 登记了例外；并断言 alias 表的 canonical 确实是被定义过的 id。
- 说明：`agent-preset/selected` 事件里出现过的**中间** id 不作改写（投影按顺序覆盖，不影响解析），只有真正决定解析结果的那一条会被迁移；因此升级后若不再需要 alias 层，跑一次 `npm run retarget:sessions -- --apply --yes --force`（先停 DSH）即可回到“零兼容层”。
#### 0.2.6-iter8（2026-11-06，旧会话自愈：用户端无感升级）

- **新增 lib/compat-heal.js**：启动后 4s 扫描 DSH_HOME/sessions，把 header 里仍是历史 id（flash-lean / flash-lean-ptc / -v1 / -v2，白名单之外一律不动）的会话改写成 flash-lean-ptc-v3。
- **只重编码首帧**：事件帧按字节拼接，绝不解码-重编码（0.2.6 截断事故的成因）。
- **写盘四道闸**：整份备份 → 临时文件 → 写后校验（帧数 + 第 2..N 帧逐字节）→ rename；任一步失败保留原文件。
- **幂等**：第二次启动零改写；锁文件互斥，日志 logs/preset-heal.log，DSH_FLASH_PRESETS_HEAL=0 关闭。
- 沙箱验证：6 条旧 id 会话样本，修复 6/6、失败 0，逐帧比对只有 agentPreset 变化。
#### 0.2.6-iter7（2026-11-06，旧会话兼容：id 不变 + 兼容别名）

- **预设 id 保持 0.2.6 的定义**：`flash-lean-ptc-v3-lite`（13 条，order 27，默认）与 `flash-lean-ptc-v3-balance`（3 条，order 26）。不再改动任何 id。
- **新增兼容别名预设 `flash-lean-ptc-v3`**（显示名「轻量PTC-v3（lean-v3 兼容）」，order 28）：规则、插件、压缩参数与 lite 完全相同，只为让 0.2.5 及更早写进会话的 lean-v3 id 能按 id 解析。选择器里因此有三张卡：lite / balance / 兼容别名。安装器（`--all-presets` 默认名单）、`merge-presets`、doctor、`verify-*` 与版本表同步收录。
- **彻底停止改写会话数据**：0.2.7 早期稿的 `scripts/migrate-legacy-preset-ids.mjs` 曾用 `zstdDecompressSync` 读会话日志再整文件重写——DSH 的 `session.v4.jsonl.zstd` 是**多帧 zstd**（首帧 header，其后每帧事件），该 API 只返回第一帧，重写会把事件流全部丢掉。现在 `--apply` / `--revert` 直接拒绝执行并打印原因，脚本只保留只读扫描（doctor `--sessions` 用）。**不要再用任何脚本原地改写会话文件。**
- 升级说明：旧 lean-v3 会话（记录 `flash-lean-ptc-v3`）直接可开，不需要迁移；`-v1` / `-v2` / `-v3b` 没有对应预设，仍需重选。

### 0.2.6-dev3（未发布，已并入 0.2.6）

- **新增两个预设，GUI 选择器里可直接手动测试**
  - `flash-lean-ptc-v3-lite`（「轻量PTC-v3 lite」，order 26，3 条规则）：保留 persona 前缀，只留引擎替代不了的三条——守语言与范围、不写密钥、同一路子连败两次就换并报确切命令与输出。
  - `flash-lean-ptc-v3-none`（「轻量PTC-v3 none」，order 29，无 persona 行）：对照组，不含任何人格规则，仅供手动对照。
- **实测与更正**（三床对照，n=5–15，详见 `实测证据.md`）：质量上各臂不可区分（算法床与 hard 床全满分；decision 床 20.13 / 19.73 / 19.73，CI 含 0）；token 配对检验无显著差异（lite/v3 = 0.86–1.22，CI 均含 1）。此前按 n=1 / n=3 得出的「lite 省 2/3 token」「persona 对结构化任务有用」等说法均在噪声内，已在文档中作废。该规模只能排除 >2 倍的差异。
- 校验同步：`verify-yaml` 对 `rules === 0` 的预设改断言「无 persona 行」，对 3 条版本只要求转录敏感一条；`compose` / `merge` / `doctor` / `install` 的预设清单都扩到四项。

### 0.2.6-dev2（未发布）

- **修复客户端插件加载失败（GUI 停在 “Failed to load plugins”）**：合并后 `lib/client.js` 的 `__ModuleLoader__.load({ id: ... })` 仍写着源码包名 `dsh-plan-mode-ui`，而 DSH 的客户端 boot graph 以**包名** `dsh-flash-presets` 作为行 id，`materialize(id)` 查不到 factory，该行永远“未到达”，前端渲染失败页。
  - 治本：`scripts/sync-lib.mjs` 同步 `lib/client.js` 时把注册 id 改写为 `package.json` 的 `name`；`--check` 按改写后内容比对，找不到源 id 直接报错（源码侧再改名不会被静默放过）。
  - 防回归：`npm run verify` 与 `prepublishOnly` 都跑 `sync-lib --check`。

- **0.2.6 的 tgz 作废**：本机开发环境 `$DSH_HOME/profiles/web/vendor/` 下缓存的 `dsh-flash-presets-0.2.6.tgz`（本地文件，不随包发布）里存的仍是旧 id，任何人再执行 `dsh plugin add` 都会把缺陷装回来，故升版（本 dev 稿）并重打包。

### 0.2.6-dev1（未发布，历史稿）

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