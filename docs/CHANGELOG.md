# 变更日志

> **版本口径（2026-11-07 发布整理）**：对外发布过 **0.2.6**（GitHub tag）、**0.2.7**（GitHub tag，npm 跳过）、
> **0.2.8**（GitHub tag + npm）、**0.2.9**（GitHub tag + Release + npm，2026-11-07 02:23 CST 发布）、**0.3.0**（GitHub tag + Release + npm，2026-11-07 发布；原计划名为 0.2.10）、**0.3.1**（GitHub tag `04b889e` + Release + npm，2026-11-12 发布）、**0.3.2**（GitHub tag `ea8c3d8` + Release + npm，2026-11-17 发布，**当前正式版**：npm `latest` 指向它）、**0.3.3**（2026-11-17 **误发**：`npm publish` 已发出，现已 `npm deprecate`，不是正式版；**内容与 0.3.2 不同** —— 0.3.3 缺第四轮 6 项修复，详见下方 0.3.3 段）。0.2.6 定稿时并入的迭代号 0.2.7–0.2.14 从未单独发布，与 0.2.7
> 这个正式版本号无关 —— 那批内容现已改名为 `0.2.6-iterN`，仍作为「同日迭代」下的四级标题保留。
>
> **日期口径**：本文件的日期是本机时区（UTC+8）的日期；npm registry 的 `time` 是 UTC，因此 0.2.1 / 0.2.3 / 0.2.4 三个版本在两边会差一天，属正常，不是笔误。

## 待发版（≥ 0.3.4）：第五轮 + 第三轮全量审计整改

> 第五轮（终审）审计的整改，逐条依据见 `docs/审计-第五轮-终审-20261117.md`。这一节的全部改动目前只在 main 上，npm 的 `latest` 仍指向已发布的那版。

| # | 类别 | 内容 |
|---|---|---|
| 1 | 修复（插件） | 计划探测改三态 + `runningAfterPlan()`：1 秒节流窗口内「计划刚落盘就动手」不再被判成没计划（收尾不再重复催 PHASE 2） |
| 2 | 修复（插件） | PTC 飞行计数改按 `subCallId` 配对（这两个事件不带 `turn`）；`turn/end` / `agent/disposed` 补齐清理；缺 `end` 的计数按 2×TTL 归零 |
| 3 | 修复（插件） | 评审守卫改「词边界」判定（`Reflect.apply` / 先取值后调用 / 解构别名不再漏），量词有界化（10 万字符输入从 1.8 s 降到毫秒级）；`ctx.get("tools")` 包 try/catch，服务缺失不再拖垮整个插件 |
| 4 | 修复（安装器） | `merge-presets`：CRLF + 行尾注释时同 id 两份（行尾 CR 让正则失配）；根序列整体缩进时结构闸放行、写出非法 YAML |
| 5 | 修复（校验） | `verify-yaml` 不再硬要求托管块里 v3 与 balance 两条都在 —— 用户保留自己改过的那条时不再装不上 |
| 6 | 测试 | merger 回归 24 → **32 条**（CRLF / 缩进根序列 / 空文件 / 重装幂等），无 js-yaml 时按「跳过」计；临时目录自清；插件 `round4.mjs` 9 条（补正控制、去掉空断言与恒真断言） |
| 7 | 文档 | tag 快照 `8f4d349` → `ea8c3d8`（8 处 + 历史快照加注）；改掉「0.3.3 与 0.3.2 内容相同」的错误说法（实测 25 文件 / 375+ / 902-）；`package.json` 版本口径 5 处 |
| 8 | 修复（插件） | 评审守卫的两种真实绕过：模板串插值（`${…}` 里的调用被整段抹掉）与正则字面量里的撇号（把后面整行抹掉）。现在插值按代码递归保留，引号只有同行能配对才按字符串处理 |
| 9 | 修复（发版脚本） | `publish-npm.sh`：CI 守卫要求全部 run `completed`（以前进行中的 run conclusion 为空，直接放行 → 先发包后绿）；新增 registry 版本序断言（已发布 / 倒挂都拒绝）；修掉报错文案缺 `@` |
| 10 | 修复（兼容层） | `legacy-preset-map.json` 的 `-lite` 改成 `rulesDiffer: true`：0.3.2 起 v3 的规则 7 措辞不同，旧说法「逐字相同」不再成立（首次命中会在启动日志提示）；同步 README / EN / 审计索引 / 别名测试 |
| 11 | 修复（CI） | bundle-install 矩阵加入 `0.2.2-rc.3`（#29 报告者的版本，也是 npm `next`）：以前只覆盖 rc.5 与 rc.1 |
| 12 | 修复（文档） | CHANGELOG 口径行「0.3.3 内容与 0.3.2 相同」纠正（该行随 npm 包发出）；审计文档日期 2026-12-01 → 20261117；写明 `v0.3.2` tag 被移动过、本地要 `git fetch --tags --force` |
| 13 | 文档（基准） | 新增 **DSH-Bench 110 题 × 6 遍** 四臂截面：正确率雷达 / 净耗时 / token 与费用三张图，README（中英）各嵌三张 + 数字表，另建 [基准文档](https://github.com/LarryE135/dsh-flash-presets/blob/main/docs/%E5%9F%BA%E5%87%86-DSH-Bench%E5%9B%9B%E8%87%82%E5%AF%B9%E6%AF%94-20261117.md) 写口径、三项折算与**题目集差异**（110 题 ≠ `dsh-bench` 仓库 v1 的 160 题 ≠ 办公基准 8+5 题 ≠ 早期 n=3 实验） |
| 14 | 文档（基准） | README 实测段改用 DSH-Bench 截面：办公基准表与图从展示面下线（`benchmarks/office/` 与 `docs/bench-office-results.json` 保留；`render-bench-table.mjs` 在两份 README 都缺标记时按「已下线」跳过）；PUBLISHING 的 npm 页面核对标记 `办公基准测试` -> `DSH-Bench`；技术文档-lean-v3 的「端到端预设对照」行改为本次截面（正确率持平 / token −34.9% / 每答对 79→63 s） |
| 15 | 结构（插件页） | **插件页上本包从 6 个组件简并为 3 个**：`flash-presets-core` / `plan-mode-ui` / `flash-presets-alias` / `delivery-gate` 四行合成一行 `flash-presets`（包根入口改为 `lib/bundle.js`，自身 inject 为空；四个功能作为子插件各按自己的 inject 启动，桌面端缺 `webServer` 时只有计划模式宿主等待，别名层 / 优化 A 照常 —— 第五轮 T1-1 的约束保持不变）。两个预设行与 id 不动。新增 `locale/{zh,en}.json` 展示元信息（卡片标题「Flash 精简预设」+ 一句话简介）和 `meta.detail` 短介绍（`docs/plugin-detail.*.md`），组合包页不再整篇渲染 README（rc.1 实测详情页高度 11527 px → 1426 px）。旧行 id 的用户覆盖（含插件页开关写下的 `disabled: true`）由 `lib/row-overrides.js` 在启动时读回并换算、日志点名；`doctor` 第 6 节静态列出。`exports` 保留 `./core` `./alias` `./delivery-gate`，新增 `./plan-mode`（原包根）。CI bundle-install 断言改为单行；`verify-core` / `verify-yaml` / `check-preset-compat` / `alias-vs-config` 同步 |
| 16 | 新增（可选组件） | **flash_sh 嵌入插件套件**：`flash-presets` 行新增 `flashSh` 子功能（默认关），插件页不新增组件。实现只在独立包 `dsh-flash-sh`（`plugins/flash-sh`，单一来源；不再有 `lib/flash-sh.js` 副本），本包以 `optionalDependencies` 引用；`dsh-flash-sh` 声明 `os:[win32]` `cpu:[x64]`，实测 DSH 的 `dsh plugin add`（pnpm）在 Linux 上跳过它、不请求 tarball、不报错。子功能动态 import，平台不对 / 依赖缺失只写一行 info。与单独安装的 `dsh-flash-sh` 并存时由进程级协调器保证只注册一个（本行优先，独立行写日志让位，本行关掉后独立行接管）。旧行 `flash-sh`（feat/flash-sh 预览安装包）的覆盖换算到 `flashSh`；`flash-sh-standalone` 的覆盖不换算、启动日志提示。`dsh-flash-sh` 同批重做审计修复：审批闸失败即关闭、子进程环境脱敏（`*KEY*`/`*PASSWORD*`/`*SECRET*`/`*TOKEN*`/`DSH_*`）、大输出头尾 + 限额溢出（0600、64 MB、24 h 清理）、审批框 2000 字预览、超时标记、会话级审批记忆（危险命令每次问）、sed/awk/diff 不支持项逐条列出 |
| 17 | 安全（flash_sh，发布前自查） | **审批分类器与子进程加固**：原分类器有 30 种写法能混进已批准的类（`PATH=… ls`、`cd .. && echo > f`、经符号链接写到外面、`perl -pe` / `-M`、`awk system()`、`sed e/w`、`git -C x clean` / `-c` / `config`、`mv` 的源、`sort -o`、`chmod`、`ln -s` 等），全部改为每次都问，新增 77 条对抗用例；环境脱敏补 `AWS_*` / `GITHUB_*` / `GH_*` / `NPM_CONFIG_*` / `_PAT` / `_AUTH` / 带账号密码的 URL；spill 文件名改 128 位随机、清理不再递归删除；taskkill 用 System32 绝对路径、失败回退；杀掉后 3 s 强行收尾不挂死；UNC workdir 在 stat 前拒绝；两包同开时独立行等 presets 表态后再注册（消除启动双注册窗口），工具注册表缺 `layers` 时退回进程内共同身份；`flashSh` 配置不合法时不挂并写明原因；旧行 `flash-sh` 的非字面量 `disabled` 按关闭处理 | `flash_sh` 默认关，只影响主动启用的用户：审批会比以前问得多一些 |
| 18 | 修复（dsh-flash-sh 0.1.1） | **P1：Windows 上 `read` 从管道 / here-string / heredoc 只读到第一行**（0.1.0 回归，`cmd \| while read` 静默只处理第一条、退出码 0）。只有确认可 seek 的磁盘文件才按块读（Windows `GetFileType == FILE_TYPE_DISK`，Unix `S_ISREG`），读完 seek 回本行末尾；管道 / FIFO 逐字节读；seek 失败时未消费字节留给下一次 `read`。`test/read-regress.mjs` 15 条 × 2 种调用方式，CI 的 windows-latest 直接跑随包 exe。内置 jq 新增 `-j`、`to_entries`、`from_entries`、`with_entries`。包版本 0.1.0 → **0.1.1**（exe 与 lib 都变了；本包根的可选依赖同步为 `^0.1.1`）；README 改正 pnpm 平台行为的说法（pnpm 照装，DSH 在组合包激活阶段拒绝）并注明 presets 集成需要 ≥ 0.3.4（尚未发布）；`test/host.mjs` 兼容 DSH 0.2.2（没有 `sdkSchemas` 时改查输出 schema，自动挂 native tool executor），`DSH_HOST_NM` 可换宿主包实测 |
| 19 | 性能 / 修复（dsh-flash-sh 0.1.2） | **下游第三轮报告的 1 个 P2（部分恢复）+ 3 个 P3 处理**。P2：0.1.1 在管道 / here-string / heredoc 上逐字节读，下游实测逐行 `read` 吞吐掉到 0.1.0 的 1/7.8（Windows，管道 10 万行 0.057 → 0.442 s、100 万行 0.136 → 4.093 s）。现在先 peek（Windows `PeekNamedPipe`、Linux `tee(2)`）再恰好读到分隔符，余量仍在管道里留给下一个读者；磁盘文件保留块内余量、每行一次 seek，块整块交接不再每行复制余量。Linux 构建实测（5 次以上中位数，对 5656ae4 = 0.1.1）：管道 100 万行 5108 → 2368 ms、1 万行 × 100 B 429 → 38 ms、20 万行文件 284 → 237 ms、heredoc 1 万行 18.7 → 14.2 ms；GitHub windows-latest（同一个 exe 对 `FLASH_SH_READ_BYTES=1` 强制逐字节 = 0.1.1 的管道读法，5 次中位数）：管道 10 万行 318–330 / 463–519 ms、100 万行 3.05–3.08 / 4.80–5.40 s、文件 20 万行 665–681 ms（Git Bash 2.8 s / 31–32 s / 3.8–4.2 s）——管道比 0.1.1 快约 1.5–1.8 倍，但**没有回到 0.1.0 的水平**（0.1.0 在管道上整块读、会丢数据），README 写明大输出改用 `readarray` 或临时文件。语义不变：read-regress 扩到 26 条 × 2 种方式（含报告 §6.2 的 4 条、read 后 head/awk/cat/mapfile、同一管道两个 fd 交替读、1 MB 单行、`read -t` 精度）。P3：read-regress 的脚本文件方式加平台守卫（Windows exe 在非 Windows 宿主上只跑 `-c`）；README 写明 `mkfifo` 未内建及替代写法；内置 jq 支持更新赋值 `\|= = += -= *= /= %= //=`（按 jq 1.7，`with_entries(.value += 1)` 可用，对照 181/181）。另：Windows 上 Job Object 改为第一次起子进程前才建（不起子进程的脚本少三次内核调用），新增 `test/job-tree.mjs` 在 CI 的 windows-latest 上验证 `--timeout` 与父进程被强杀时整棵树（含 find -exec / xargs 的孙进程）都结束；awk `c[$N]++` 少一次分配和哈希（awk_count 21.3 → 16.7 ms）；windows-sys 统一到 0.61（构建图 246 → 243 个 crate，exe 大小不变）。体积：试过 `panic=abort`（−789,504 B）未采用——管道 / 命令替换各段在线程里跑、靠 unwind 兜底，abort 会让任一段 panic 直接结束整个 shell；`opt-level=s` 比 z 大 1,192,960 B，保持 z。exe 8,020,480 B（+28,672），sha256 `59f8f73c…3eebaa0ed`，`.sha256` 与 `check-flash-sh.ps1` 同步；包版本 0.1.1 → **0.1.2**（本包根的可选依赖同步为 `^0.1.2`） |
| 20 | 性能 / 体积（dsh-flash-sh 0.1.3） | **逐行 read 延迟交还 + sed 依赖去重**。本 shell 自建、没交给别人的管道（流水线、here-string、heredoc）和 `< 文件`：`read` 用掉的行先不向系统取（管道里的留在管道里、文件位置停在块尾），peek 的拷贝用完时一次取走；在任何别的读者之前结清（别的命令 / applet、子进程、流水线开始、后台任务、`read` 换 fd、`read -t` 等输入、`mapfile`、线程结束）；交给过子进程 / 后台任务 / 同时运行的两段流水线、或从父进程继承来的管道和文件不延迟（仍逐行实取并比对）。Linux 构建实测（同一构建配置、5 次中位数、计数确认行数，0.1.2 → 0.1.3）：管道 10 万行 242 → 104 ms、100 万行 2335 → 1042 ms、here-string 2 万行 38.5 → 22.4 ms、heredoc 1 万行 13.8 → 11.7 ms、文件 20 万行 236 → 215 ms。下游报告的 0.1.0 管道数字（10 万行 0.057 s）来自不数行的循环：0.1.0 在 Windows 管道上每次 `read` 读走一块只用第一行（按源码），不能作目标；`test/read-bench.mjs` 改为每项先计数，CI 同时对 0.1.0 的 exe 计数计时。read-regress 扩到 38 条 × 2 种方式（break 后 wc/head/awk/mapfile、命令替换 / 流水线段 / 子 shell / 函数 / eval 读同一 stdin、两 fd 交替、文件 break 后 applet 读、20 万行计数、lastpipe、`read -t` / `-t 0` 不把已用的行当成新输入）。体积：sed 0.3.0 改用补丁版（只把依赖改到 uucore 0.13 / fancy-regex 0.20，去掉库里不用的 clap_complete / clap_mangen / phf / predicates / textwrap），构建图 243 → 225 个 crate（THIRD_PARTY_LICENSES 同步）；applet 分派改函数指针表。exe 8,020,480 → 7,868,928 B（−151,552，−1.9%），sha256 `c83f196a…68be2589`，`.sha256` 与 `check-flash-sh.ps1` 同步；包版本 0.1.2 → **0.1.3**（本包根的可选依赖同步为 `^0.1.3`） |
| 21 | 修复 / 兼容（dsh-flash-sh 0.1.4） | **0.1.2 实机报告（Windows 11 + DSH 0.2.2-rc.5，对照 Git Bash 5.2.37）P1–P7 的处理 + 自查修复**。P1：`check-flash-sh.ps1` 第 3 项不再给 `$LASTEXITCODE` 赋值（脚本作用域里赋值会遮住自动变量，pwsh 7 下误报「退出码 -1，输出：ok」），先清全局值再读 `$global:LASTEXITCODE`；CI 的 windows-latest 在 pwsh 7 与 PowerShell 5.1 下各跑一遍自检，断言第 3 项判定正确。P2：`flash-sh --version` 以前一直报 `0.1.0`（Cargo.toml 没跟包版本同步），现在 exe 报 `flash-sh 0.1.4`；新增 `test/version.mjs` 核对 `--version`、vendor exe 的 sha256、`.sha256` 文件与自检脚本期望值四者一致。P3：spill 目录在 DSH 正常退出时删掉本进程自己的那个（只删 spill 日志与空目录、不递归、不跟链接）；强杀残留的仍由启动时 24 h 清理兜底。P4：`test/read-regress.mjs` 开跑前探测被测 exe 能否写临时目录和工作目录，不能写时（低完整性标签目录 / 杀软）说明原因并跳过写文件的用例，不再报成失败。P5：超时按实际毫秒传给 exe（1600 ms → `--timeout 1.6`，提示「timed out after 1.6s」），不再向上取整到整秒。P6：`sh` / `bash`（`-c`、脚本、管道喂入）在 exe 内一律由 flash-sh 自己执行，不会调到 PATH 上的 Git Bash 或 WSL；审批上 `sh` 的各种写法与 `bash -c` 同等、每次都问（对抗用例 +10）。P7：README 新增「与 bash / Git Bash 的其他已知差异」（报告第 4 节每一条按 0.1.4 实际情况写明）和「低完整性目录与杀毒软件」排障。报告第 4 节里一并补上的：`cmp`、`nproc` applet；`/dev/zero`、`/dev/urandom`、`/dev/random` 可读（系统 CSPRNG）；`time` 保留字（`-p`、`TIMEFORMAT`）；`type -a` 列全部；`read -p` 只在终端时把提示写 stderr；`timeout` 能跑内建命令。不改的（README 写明原因与替代）：`${#s}` 按 UTF-8 字符计、`$( )` 保留 NUL、`ls -l` 权限位、`du -sh` 小目录、`ulimit -n`、`id` / `stat` / `chmod` / `ps`。自查修复：`mapfile -n N` 只从输入取 N 行（以前会把剩下的也读走）、`mapfile -u fd` / `-s` / `-O`；`read -N` 不按 IFS 拆分；流水线段里的 EXIT trap；后台任务启动前先冲刷本 shell 的输出缓冲。另：vendored sed 补齐 PATCHES / LICENSE 说明，`THIRD_PARTY_LICENSE_TEXTS.txt`（225 个 crate、去重后 82 份许可全文）随包发布。exe 7,868,928 → 7,890,944 B（+22,016，+0.28%），sha256 `826808f3…cab358aa1`，`.sha256` 与 `check-flash-sh.ps1` 同步；包版本 0.1.3 → **0.1.4**（本包根的可选依赖同步为 `^0.1.4`） |
| 22 | 构建（dsh-flash-sh 0.1.5） | **只改了构建路径重映射和版本号，没有行为变化**。0.1.3 起发行 exe 里带着构建机的绝对路径（cargo 注册表下的依赖源码路径，约 370 处，出现在 panic 位置等字符串里）：flash-sh 发行构建脚本 `build-dist.sh` 加 `--remap-path-prefix`（cargo 注册表 → `/cargo`、本 crate 源码 → `/src`、rustup 工具链的 rust-src → `/rustc/<commit>`；可选 C 代码用 `-ffile-prefix-map`），重编后 exe 里构建机路径 0 处。0.1.4 的包已经交出去，同一个版本号对应两个哈希会让自检脚本误报，所以版本升为 **0.1.5**（`flash-sh --version` 同步）。exe 7,890,944 → 7,878,656 B（−12,288，路径字符串变短），sha256 `f4dd7e33…a995d8e64`，`.sha256` 与 `check-flash-sh.ps1` 同步；本包根的可选依赖同步为 `^0.1.5` |

## 0.3.2（2026-11-17，当前正式版：npm `latest` 指向它；`v0.3.3` 是误发版）

> 预设 id 与压缩/裁剪参数未改动；persona 规则正文未改，**但 v3 的规则 7 措辞调整了**（需要单调用时也走一行 run_code 程序，与 PTC 一致），
> 计划模式行另补了 #29 的政策句（PTC 下调 `exit_plan_mode` 要带 `timeoutMs: 600000`），见下表第 8 条。
> 2026-11-17 补：第二轮外部审计的 P1（发版物版本口径）与建议同版修的 P2 已一并处理，见第 10、11 条。

### 条目一览（第二批：图标 v1.1 / 上下文瘦身 / 交付门默认关闭 / 计划模式）

| # | 类别 | 条目 | 影响面 |
|---|---|---|---|
| 1 | 瘦身 | `cordis.patch.yml` 默认带上两条上下文瘦身：`tool-skill.catalogDescriptionMaxLength: 60`、关闭 `session-log-deepseek` / `plugin-package-inventory-deepseek`（两份上报合计每请求少传约 40 KB，不进上下文） | 默认配置 |
| 2 | 修复 | 交付门 `delivery-gate` 默认值由 `true` 改为 `false`：0.3.1 的默认会让普通对话也被验收门追着跑（插件卡建行时不会带本包的路由配置，schema 默认值即唯一防线） | 需显式开启 |
| 3 | 修复 | 计划模式：「空跑一场」不再被当成批准 —— 只有规划阶段真的产出过助手文本，`plan/mode` 关闭才触发 PHASE 2 投递 | 计划模式 |
| 4 | 变更 | 计划模式作用域默认 `always` → `auto`（首轮必规划，之后只在任务明显变化时重规划） | 计划模式 |
| 5 | 重做 | 自动批准按钮换成 v1.1 字形：两段环箭头 + 中心对勾，三态（off / on / fire）已全部接通——宿主按会话统计「真正命中自动批准」的次数并随状态下发，客户端用 a/b 交替重放冲击帧（首帧只记录、不播放，刷新页面不会误脉冲）；20px；顺带修掉旧规则 `.pmo-aa svg` 强制 15px 与「所有 svg 一起旋转」导致的**对勾跟着外圈转**、图标始终长不大 | `plan-mode-ui` |
| 6 | 研究 | 新增文档：`研究-DSH0.2.2-Team-Agent.md`（Team 的 token 成本与配置面）、`研究-DSH-0.2.2-rc.3-上下文注入.md`、`上游讨论-长开发会话成本归因.md`、`会话审计/`（重试浪费、上下文与内存两篇） | 文档 |
| 7 | 工具 | 新增 `scripts/ptc-redeclare-fix/` 与 `patches/`：`run_code` 顶层重复声明（实测 57/120 次失败）的本地复现与可回滚补丁；**不随安装流程生效**，仅供手动选择 | 手动 |
| 8 | 修复 | **#29**：PTC 预设下计划评审被 run_code 的 120 秒默认截止打断（ASK_ABORTED）后重复提交 —— 插件用 tools.guard 在派发前拦下「调用 exit_plan_mode / ask_user_question 却未给 timeoutMs ≥ 600000」的 run_code，不执行、不弹卡；政策文本同步要求 PTC 下评审批次带超时、中止不等于拒绝、不要自行重交；README 补「light 档会自动进计划」与超时说明；审计后收紧：判据只认调用形态（写文档/注释里提到工具名不再误拦）、守卫不可用打 warn、状态接口补 disabled 字段 | plan-mode-ui / 预设政策 |
| 9 | 整改 | **外部全量审计（2026-11-17）逐条核对后修复**：宿主事件形态（`{type,seq,time,data}`，`user/message` 不带 turn）导致 `scope=auto/first` 失效、改档位丢 `autoApprove`、守卫在自动批准下连 `ask_user_question` 一起放行、交付门关闭仍注入不存在的 `verify` 工具、交付门被后台进程挂死整回合、`/api/plan-mode/*` 挡不住 DNS rebinding、`prune-stale-presets --apply` 删掉整个 insert 块、发布脚本三处互锁、安装器写不存在的 `#v0.3.2` 等；明细见 `docs/审计-外部报告核对与修复-20261117.md` | 插件 / 脚本 / 预设 / 文档 |
| 10 | 修复 | **发版物版本口径**（第二轮审计 P1-1）：`publishedVersion` 跟上 0.3.2，install.sh / install.ps1 / marketplace / README 中英的 `@` 与 `#v` 引用统一到 0.3.2；`publish-npm.sh` 新增三道守卫（publishedVersion 一致、安装器与市场清单无旧版本引用、tag 必须在 `origin/main` 上）| 发布流程 |
| 11 | 修复 | **第二轮审计建议同版修的 P2**：`/api/plan-mode/progress` 补 Host 白名单（与 `/state` 同口径，403 时面板直接提示设 `DSH_FLASH_PRESETS_TRUST_HOST=1`）；balance 预设的评审政策句同步到 v3 并去掉重复的半句；交付门在 Windows 上默认找 `verify.ps1`、按扩展名选解释器、缺解释器记为跳过，收尾清进程组（不再留下后台进程）；`bench-release-checklist` 改用 `git ls-files -z`（中文路径不再被 quotepath 跳过/自伤）；随包文档与事实对齐（压缩阈值、规则 7、0.3.1 的 gitHead）| 插件 / 脚本 / 文档 |

### 为什么这两条瘦身要做成默认

实测（`docs/研究-DSH-0.2.2-rc.3-上下文注入.md`）：技能目录按每条描述全文注入，技能一多就是上千字符；两项 DeepSeek 专用上报虽不进上下文，但每请求都会把整份会话日志与插件清单**再传一遍**。两者都是纯输入侧开销，压缩到 60 字符与直接关掉不改变行为。两条都是 `patch`（非 `insert`）条目，DSH 的 `applyPatches` 对它们是「有则改、无则只警告」，放进没有这些行的 profile 也不会让启动失败。

### 第三轮自查整改（P0 1 / P1 3 / P2 10 / P3 12）

| # | 类别 | 条目 | 影响面 |
|---|---|---|---|
| 1 | 修复 | **安装器静默删掉用户改过的预设行**（P1）：`merge-presets` 的认领只比结构（包装行 + `config.id`），把用户改过 `thresholdRatio` 的同 id 条目当残留整条替换，还打印「内容与安装器写入的一致」 | 脚本安装 |
| 2 | 修复 | **full 档「批准后转执行」在 rc.3 投递不到**（P1）：`agent.steer()` 在 `session/event` 里同步调用会撞宿主 append 重入守卫（异常被吞）；改为宏任务投递，中途纠偏同样处理 | 计划模式 full 档 |
| 3 | 修复 | **PTC 下「规划期先动手」检测失效**（P2）：嵌套调用不发 `tool/call`，补上 `tool/ptc-dispatch-start` / `tool/ptc-dispatch` 两个分支（含回归测试 F4/F4b/F4c） | 计划模式（默认预设即 PTC） |
| 4 | 修复 | **两处服务访问静默失效**（P2）：`ctx.webServer` / `ctx.sessionProjections` 未 inject 时直接取会抛、兜底永远轮不到 → 改走 `ctx.get`；core 状态路由与内置 `/plan` 让位闸恢复 | 运行时 |
| 5 | 修复 | **发版脚本 fail-closed**（P2）：`publish.sh` 的 CI 闸门不再「查不到就跳过」（`ALLOW_UNKNOWN_CI=1` 才放行）；`DRY_RUN` 挪到远端 tag 守卫之后；`verify-versions` 不再被 `dist/` 旧 zip 卡死；`tune-runtime` 缺补丁文件时不再 ENOENT 崩 | 发版流程 |
| 6 | 修复 | **交付门按平台选脚本**（P2）：出厂补丁不再钉死 `scripts: [verify.sh]`，Windows 上 schema 默认 `verify.ps1` | 交付门 |
| 7 | 修复 | **离线安装入口钉在 v0.3.0**（P1）：README 中英的 `git clone -b` 改到当前 tag，`verify-versions` 新增 `-b vX.Y.Z` 断言 | 安装文档 |
| 8 | 修复 | **发版物口径**（P0）：所有「已发布」措辞改成可复核表述（以 `npm view` 为准 + `#vX.Y.Z` 兜底）；`publishedVersion` 与仓库版本号一致（现为 0.3.2；误发期间曾一度是 0.3.3） | 文档 |
| 9 | 修复 | **文档口径与指向**（P2/P3）：撤掉「300k 以上」「0.25 每次都真压缩」；54 项自测 / 30 个插件测试文件 / 插件 1.0.0；`align-presets.sh` 指向不存在的脚本；v1/v2 别名说明；README 中文缺失的排障日志块 | 文档 |
| 10 | 修复 | **评审守卫误拦**（P3）：方括号形式必须后跟 `(` 才算调用 —— 只取值 / 注释 / 字符串里出现工具名不再触发（三种真调用仍拦） | 计划模式 |
| 11 | 修复 | **杂项加固**（P3）：`install.sh` 安装路径也 prune 备份；`verify.yml` concurrency 计入 `event_name`（schedule 不再取消 push 的 run）；badge job 加 10 分钟与 fetch 20 秒超时；插件包 `engines.dsh` 挪到顶层并收窄区间 | CI / 安装器 |

### 第四轮审计整改（本轮）

| # | 类别 | 条目 | 影响面 |
|---|---|---|---|
| 1 | 修复 | **计划模式下同步 steer 撞宿主的 append 重入守卫**：在 `session/event` 里同步调 `agent.steer()` 会抛（宿主 `publicationEntry()` 的 `appending` 守卫），异常被 `catch` 吞掉 → 改成宏任务投递 | 计划模式 full 档 |
| 2 | 修复 | **PTC 预设下 `run_code` 内部的工具调用不发 `tool/call`**：改用 `tool/ptc-dispatch-start` 与 `tool/ptc-dispatch`，纠偏与「已在执行」判定与 `tool/call` 同语义 | 计划模式（默认预设即 PTC） |
| 3 | 修复 | **评审超时守卫（`tools.guard`）**：不再把「注释 / 字符串里写了调用形态」当真调用；同时补上 `tools["<名字>"]?.()`、模板键、`.call(` 等真调用形态 | 计划模式 |
| 4 | 修复 | **`merge-presets` 认领历史残留时按缩进算条目边界**（以前按第一个空行 → 199 行条目只读到 13 行、被判成安装器写的、删头留尾写坏 YAML）；`- insert:` 数组改成逐条摘（别人的条目与数组内注释都保住）；卸载路径加「顶层必须是块状数组」结构闸；全部条目都被用户改过时不再写空托管块 | 脚本安装 / 卸载 |
| 5 | 测试 | 新增 `scripts/test-merge-presets.mjs`（24 条断言）并接进 `scripts/selftest.sh`（自测 54 项） | 校验 |
| 6 | 文档 | 本轮文档口径整理：0.3.2 追认为正式版、0.3.3 标为误发（npm 上已 deprecate）；`npm run verify` 的检查条数、插件测试文件数、`scripts/` 文件数按实测改写 | 文档 |

## 0.3.3（2026-11-17，误发版本：npm 上仍有、已 `deprecate`）

> **这一版是版本号写错的产物**：原计划按 0.3.2 发布，`package.json` 被写成 0.3.3 且已 `npm publish`。
> 处置：**0.3.2 追认为正式版**（npm `latest` 指向它），0.3.3 标为误发并在 npm 上 `npm deprecate` —— 仍可安装，但不是正式版。
> **2026-11-17 晚**：GitHub Release v0.3.3 已删除（正文与附件），tag `v0.3.3` 按冻结规则保留；npm 0.3.3 仍可安装、已 deprecate。
> **包内容与 0.3.2 不同**：0.3.3 是第三轮整改的提交（`54fc895`）打的包；0.3.2 在其上又并入了第四轮 6 项修复，两包有 11 个文件不同（`git diff --stat v0.3.2 v0.3.3`）。
> **装包请写死版本号**：范围会随 registry 漂移；pnpm 11 默认冷却期（`minimumReleaseAge`）里刚发布的版本裸装会退到上一版。

## 0.3.1（2026-11-12，npm 已发布 · GitHub Release 已发；上一版正式版）

> 0.3.0 之后，`main` 上还积累了三批当时按「不升版号、不发 Release」记的修正（11-08 / 11-09 / 11-10）。本版把它们一次性收口成一个正式版本。
>
> **预设 id、规则文本、压缩阈值、裁剪参数全都没动**，装法也没变（插件卡 / bundle / 脚本三条路照旧）。改的是两件事：**装上包到底有没有真的用上优化**，以及**诊断说的到底是不是真的**。

**头条：`run_code` 优化 A 现在「装上即生效」。** 此前它搭的是 `plan-mode-ui` 那行的车：关掉计划模式、或用只挂部分行的精简组合，优化会**静默消失**；headless 下更因为 `plan-mode-ui` 停在 `pending (waiting for service: webServer)` 而完全跑不到。现在它独立成 `flash-presets-core` 一行，只 `inject` `tools` / `agents`，任何宿主都能挂——「装上这个包」就等于「`run_code` 优化生效」，与计划模式开不开无关。关闭方式优先级：`DSH_FLASH_PRESETS_CONCURRENCY=0` ＞ 该行 `config.toolConcurrency.enabled=false` ＞ 默认开启。

### 条目一览

| # | 类别 | 条目 | 影响面 |
|---|---|---|---|
| 1 | 生效 | `run_code` 优化 A（`glob`/`grep` 只读并发安全）独立成 `flash-presets-core` 行，装包即生效，与计划模式无关 | 插件卡 / bundle 安装 |
| 2 | 修复 | 子代理「选模型 / 列模型」在 DSH 0.2.2 上一直是关的（#21）：补 `modelSelection` / `modelDiscovery`，删 4 处 `backgroundMode` | 两份预设 |
| 3 | 新增 | 交付门 `delivery-gate`：把「验收」从 persona 里的一句话变成运行时机制（默认关闭） | 需显式 `enabled: true` |
| 4 | 诊断 | `doctor` 新增第 9 项：profile 里与本机 dsh 版本对不上、会被静默禁用的插件 | 诊断输出 |
| 5 | 修复 | `doctor --all` / `audit-compat` 在空环境下的三处误报（第七轮审计 A3） | 全新安装不再判红 |
| 6 | 修复 | 别名层 v1/v2 规则差异警告不再给走不通的办法（A7）；`check-preset-compat` 在 npm 包里直说原因（#24） | 旧会话提示语 |
| 7 | 守卫 | 别名行与两份冻结预设不许 `disabled`（A8）：`verify-core` 新增 8 条断言 | 校验项 145 → 153 |
| 8 | 新增 | `scripts/verify-session-compat.mjs`：升级后旧会话能否打开的自动化守卫（A5），含两条反向控制 | 进 `npm run verify` 与 CI |
| 9 | 变更 | `runDshCapture`：Windows 上 7 处 CLI 调用统一走包装（#23） | 仅 Windows |
| 10 | 措辞 | `install.sh` 不再叫 lite / balance（#25），就地叫 v3 / v3 balance | 安装提示 |
| 11 | 校正 | 压缩阈值 0.25 / 20000 是安全网不是降本手段（109 次运行峰值中位 20k、最大 126k，250k 从未触发）；真正压上下文的是 `tool-result-pruner` 8192 | 注释与文档口径 |
| 12 | 否决 | v4 候选规则「契约先行」「长文阅读」实测否掉，不进预设 | 规则文本不变 |
| 13 | CI | 三处红灯收口（过期断言 2 项 + 第 7 节形态 + macOS 预算）、`npm run verify` 直跑、随包文档陈述对账 lint | CI / 本地校验 |
| 14 | 文档 | 全量审计报告、CHANGELOG 恢复被误删的 0.2.5–0.1.0 历史、README 的安装版本与交付门口径订正 | 文档 |
| 15 | npm | 0.2.2–0.2.9 五条弃用提示语各自写自己的事实（A4），全部指向 0.3.0 | npm 元数据 |
| 16 | 流程 | 发布链路补守卫：`scripts/verify-published.mjs`（发布后校验 registry 与 `latest`）、`scripts/publish-npm.sh`（发布 + 复核）、`publish.sh` 建 Release 前强制确认 npm 已生效；`sync-published-version.mjs` 现在真的同步 marketplace / README 的 npm 引用 | 只影响发布，不影响用户行为 |
| 17 | 随包 | 计划模式组件 `plan-mode-ui` v1：一个回合内两阶段（先计划、自动投递执行）+ SVG 状态字形 + `TODO SYNC` 纪律 + Max 开关；本版修设置页被会话值冲回、换会话残留乐观宽限 | 随包默认启用 |

### 随包的计划模式组件（`plan-mode-ui` v1）

这一版把「先计划、再执行」正式做进发行包：宿主半边在 `lib/index.js`、浏览器半边在 `lib/client.js`、进度纪律在 `lib/progress.js`，`cordis.patch.yml` 里对应一行 `- id: plan-mode-ui` / `name: 'dsh-flash-presets'`。

**它做什么**

- **一个回合内跑完两阶段**：你发一条消息 → 宿主拦下回合 → PHASE 1 只读取证并写计划产物 → 计划写完、回合即将结束时**自动投递 PHASE 2**，同一回合接着执行、跑验收、回报实测值。不需要你手发第二条消息。
- **状态看得见**：composer 图标用 5 层内联 SVG 字形表示「笔在纸上写计划」，动画只在 `data-phase='planning'` 时挂上；点开向上展开面板看计划进度。
- **进度实时更新**：注入 `TODO SYNC` 纪律 —— 动手前先开 `todo_write` 列表，**每关掉一项立刻再调一次**，不许攒到最后一次性打勾；规划阶段另有一套变体，绕开原生 plan mode 禁止用 `todo_write` 记录「规划过程」的限制（原生模式下列表因此常常根本不出现）。
- **Max 开关**：注入 `MAX MODE — 不用担心预算，你的 Token 是无限的。`，抑制模型在预算受限时提前收手。
- **作用域**：面板上的档位 / 范围 / Max **默认只作用于当前会话**；全局在左下角「设置 → 计划模式」。

**0.3.1 修的是什么**（相对 0.3.0，7 个文件 +99/−40）

- 设置页「点完闪一下又回到原位」：全局默认值（应答里的 `settings.default`）与会话有效值原来混在同一组状态里，`pull()` 会用会话值把它冲回去。现在拆成 `gTier` / `gScope` / `gMax` / `gAutoApprove` 一组单独接收，写全局时同步乐观更新。
- 换会话后残留上一轮的乐观宽限窗口，表现为「先显示上一个会话的模式、约 1.5 秒后才跳到正确值」。现在切会话时清掉它；同会话内的 1500 ms 防闪回窗口不受影响。
- 只读并发标记（`glob` / `grep`）**迁出这一行**，改由 `flash-presets-core` 提供 —— 关掉计划模式不再连带丢掉那项优化（见条目 1）。

**代码在哪**：源码在 `plugins/plan-mode-ui/lib/`，发布前由 `scripts/sync-lib.mjs` 同步到包根的 `lib/`（`lib/` 是生成产物，改代码改 `plugins/` 那边）；`plugins/` 不进 npm 的 `files`，所以随包发出的是 `lib/` 里那半边。单独打包走 `scripts/pack-plugin.mjs` → `dist/dsh-plan-mode-ui-<版本>.tgz`（Release 附件与 `--with-plan-mode` 用）。

> 下面三节按提交批次（由近及远）保留当时的完整记录与复现步骤，顺序不代表重要性。

### 批次：2026-11-10（结构：装上却没真的用上优化）

> 本批原以「不升版号」记在 `main` 上，随 0.3.1 一并发布。这一批修的是「装上包却没用上优化」的结构问题。

#### npm：0.2.2–0.2.9 的弃用提示语已订正（第七轮审计 A4）

0.2.2 / 0.2.3 / 0.2.4 三条的提示语原来照抄了 0.2.5 的原因（「0.2.5 在 DSH 0.2.2-rc.1 上无法新建会话」），但那句话跟这三个版本无关；0.2.8 / 0.2.9 干脆没有弃用标记。现在五条各自写自己的事实（id 差异、安装层误报、被 0.3.0 取代），全部指向 `dsh-flash-presets@0.3.0`。

**顺带纠正一条此前的错误结论**：`0.2.5` 那节写着「Automation token 已随 npm 收紧 bypass-2FA 一并失效，不要再依赖它」。失效的是 **classic** token；**Granular Access Token 勾上「Bypass two-factor authentication」仍然有效** —— 本次五条弃用就是这样发出去的（账号仍是 `auth-and-writes`，全程没有输入一次性验证码）。以后要发布或改 dist-tag，走这条路。

复现：`npm view dsh-flash-presets@0.2.8 deprecated`；`dist-tags.latest` 仍是 `0.3.0`，未被弃用。

#### 措辞：v1/v2 的规则差异警告不再给一个走不通的办法（第七轮审计 A7）

别名层命中 `rulesDiffer` 的 id 时会警告「规则变了」，原来那句建议是「在自己的 profile 补丁里加回原来那一行」。问题在于：v1/v2 是 0.2.5 时代的卡，**那几行在 DSH 0.2.2 上本身就加载不了**，照做不生效。

改成两条真能走的路：① 继续用 0.2.8 或更早的版本打开这段对话；② 照警告里给出的原规则参数，用当前语法自建一条同规则的预设。警告里同时带出这条的历史参数（「14 条 / 0.3·50k」这类），不必再去翻 map 文件。

测试跟着加严：`plugins/plan-mode-ui/test/preset-alias.mjs` 第 ⑨ 组断言警告里**不许出现「加回」**、且必须写明 `0.2.8` 这条退路；把措辞改回旧说法时该断言必然失败（已反向验证）。

#### 守卫：`check-preset-compat` 在发行包里直说原因（第七轮审计 #24）

这个脚本要从每个历史 tag 里读预设定义才能判定兼容性，而 npm 包里既没有 `.git` 也没有 tag —— 以前它先抛一条 git 报错，看起来像「东西坏了」。现在开头先看有没有 `.git`，没有就说明原因、给出克隆命令并 exit 0。

#### 新增：升级后旧会话能否打开的自动化守卫（第七轮审计 A5）

这类回归的症状是「装上新版，旧会话直接打不开」，而且是**静默**的 —— 只有打开那个会话时才炸；此前没有任何测试覆盖它。

`scripts/verify-session-compat.mjs` 在临时 `DSH_HOME` 里造 10 类会话（5 个历史 id / 2 个现役 id / 内建 `ptc` / 没有 `agentPreset` / header 写旧 id 而最后一条 `agent-preset/selected` 写新 id），交给真正的解析器判：

- `audit-compat` 必须 exit 0：5 个历史 id 走别名层、4 类按定义、1 类 none、零孤儿、零结构可疑；
- **反向控制 1**：`--no-alias`（脚本安装形态）时那 5 类必须判「解析不到」且 exit 1 —— 证明测试有牙；
- **反向控制 2**：塞一个不存在的 id，必须进 orphan 且 exit 1；
- `doctor --sessions` 的 `[7]` 段必须是通过态、无 `✗`。

顺带修了 `audit-compat` 的两个盲点：`rosterFromDump` 现在把内建预设（`standard` / `minimal` / `ptc` / `cordis`）并进 roster —— 它们由上游组合包提供，dump 里不一定逐条出现，之前会把内建预设的会话误报成孤儿。

校验项随之变化：`npm run verify` 增加这一步，CI 另加同名步骤。

#### 修复：doctor / audit-compat 在空环境下误报（第七轮审计 A3）

三处误报，都会把「没问题」说成「有问题」：

1. **脚本安装 + 一个会话都没有时，`doctor --all` 判红并 exit 1。** 随包不带旧会话扫描器（`migrate-legacy-preset-ids.mjs` 会写会话，故不发布），那一段就在没有扫描器时无条件 `bad('本形态没有兼容层…')` —— 全新安装、`sessions/` 根本不存在也照判红。现在先看有没有会话：没有就 `ok('没有会话目录…本项无需检查')`；有会话但判不了，改用 `warn` 说明「本份安装没有扫描器，无法逐条确认」，不再计入失败。
2. **脚本安装形态把「托管块里有兼容行」的 -lite 会话也算成打不开。** 升级路径会给 `-lite` 留一行兼容行（见 `[3]` 的处置），块内有定义就该能打开。现在按「块内有没有定义」判定，只把既无别名层、块内也无定义的 id 判红。
3. **audit-compat 一边报 `✖ 本形态没有别名层…解析不到`，下一行又打 `✓ 没有孤儿 id：全部会话的 preset 都能解析`。** 两句话互斥。现在只有在没有未解析会话时才打那句 ✓，否则改打「孤儿 id：0（上面那批只是缺别名层）」。

实测（解包的 npm 包 + 空的 `DSH_HOME`）：修前 `doctor --all` exit 1；修后 exit 0、`✗` 零行、输出 `✓ 没有会话目录（~/.dsh/sessions），本项无需检查`。

#### 文档：计划模式与 chatgpt-subscription 叠加的已知限制（issue #22）

计划模式的档位状态对监听 `planMode` 的插件是可见的；`chatgpt-subscription`（0.62.0–0.63.1）在这种状态下会给「只说话、不调工具」的回合注入提醒，于是模型再答一遍。两版 README 的「已知限制 / Known limitations」都补了这条，并给出缓解办法（这类会话把档位切到 `off`）。机制是读代码确认的，本机没有复现到「答两遍」。

#### 守卫：别名行与两份冻结预设不许 `disabled`（A8）

别名行一旦 `disabled: true`，旧会话就整体打不开；预设行一旦 `disabled`，卡片从列表里消失——两者都不报错，只有 `compose --check` 会拦。`scripts/verify-core.mjs` 加了 8 条断言（组合包里这四行存在 + 行级 `disabled` 不存在），校验项 145 → 153。反向验证：给别名行种一行 `disabled: true`，`verify-core` exit 1。

#### 措辞：install.sh 不再叫「lite / balance」（issue #25）

0.3.0 起 id 里就没有 lite 字样了（`flash-lean-ptc-v3` / `-balance`），安装脚本的注释与收尾提示还写着 `lite / balance`，容易让人去找不存在的卡片。改成就地叫 `v3 / v3 balance`。

#### 修复：子代理的「选模型 / 列模型」开关在 DSH 0.2.2 上一直是关的（issue #21）

`tool-subagent` 在 DSH 0.2.2-alpha.2 把 `modelSelectionSettings` 拆成了 `modelSelection`（能不能让子代理选模型）与 `modelDiscovery`（能不能先列出可选模型）。预设只写了旧名，而 0.2.2 只读新名 —— 结果是 **`engines` 区间里的新版上这两个功能一直是关的，且不报错**（`z.object` 非 strict，未知键直接 strip）。

实测（本机 dsh 0.2.2-rc.1）：`@deepseek-ai/dsh-tool-subagent/lib/index.js:304-305` 声明 `modelSelection` / `modelDiscovery`，全文没有 `modelSelectionSettings`。

改法：两份预设同时写三个字段（旧版读旧名、新版读新名，互不干扰）；顺手删掉 4 处 `backgroundMode` —— 在整个 `engines` 区间里没有任何代码读它。

#### 修复：自测里的 gh 代理用例会被环境变量污染

`scripts/selftest.sh` 的「gh_ 的环境前缀」用例在继承 `HTTPS_PROXY` 的环境里必然失败（端口不通时 `gh_` 按设计「继承环境」，而断言期望空）。改为在子 shell 里先 `env -u` 三个代理变量再测。

#### 修复：run_code 优化 A 现在「装上即生效」（独立成行 `flash-presets-core`）

**问题。** 0.3.0 把优化 A（给 `glob` / `grep` 补 `isConcurrencySafe`，让同轮多个搜索并行）写在 `lib/index.js` 的 `apply()` 里，而那一行是 `plan-mode-ui`。两个后果：

1. 关掉计划模式组件、或用只挂部分行的精简组合 → A 静默消失，日志里一个字都没有；
2. `plan-mode-ui` 的 `inject` 含 `webServer` / `systemPrompt`，宿主缺任一个就停在 `pending`，连带 A 也不跑。

**证据（同一台机器，两个干净 `DSH_HOME`，`dsh headless` 各跑一次）。** npm 上的 0.3.0：

```
plan-mode-ui (dsh-flash-presets): pending (waiting for service: webServer)
flash-presets-alias (dsh-flash-presets/alias): pending (waiting for service: agentPresets)
（日志里 tool-concurrency 出现 0 次）
```

修完之后的 `main`：

```
plan-mode-ui (dsh-flash-presets): pending (waiting for service: webServer)
[tool-concurrency] v0.3.0 生效｜targets=glob,grep｜sweep=500ms｜witness=glob=true grep=true｜scopes=1
```

**改法。**

- 新增 `lib/core.js`，导出 `dsh-flash-presets/core`，只 `inject: ["tools", "agents"]`；`cordis.patch.yml` 里对应独立的 `flash-presets-core` 行，排在 `plan-mode-ui` 之前。
- `lib/index.js` 不再调 `installToolConcurrency`（改了 `plugins/plan-mode-ui/lib/index.js` 源文件再同步），避免两处都装。
- 日志收敛成一行：`[tool-concurrency] v<版本> 生效｜targets=…｜sweep=…ms｜witness=…｜scopes=N`；关掉或装不上时打 `未生效｜原因=…`，不再静默。
- 状态可用性：宿主有 `webServer` 时额外挂 `GET /api/flash-presets/core`；没注入就不挂，headless 也能加载。
- 关闭方式的优先级写进 README：`DSH_FLASH_PRESETS_CONCURRENCY=0` ＞ 该行 `config.toolConcurrency.enabled=false` ＞ 默认开启。

**守卫。** 新增 `scripts/verify-core.mjs`（已进 `npm run verify`，校验项 134 → 145），用假 ctx 断言四件事：独立行只 inject tools/agents、装上即有带版本的 `生效` 行且 `witness=glob=true grep=true`、关掉时打 `未启用`、工具缺失时打 `未生效`。CI 另加一条「组合配置里必须出现 `flash-presets-core` 行」的断言。

**没变的。** 预设规则文本、压缩阈值、裁剪参数、交付门默认值都没动；A 只影响调度与墙钟，不影响请求数、token 与正确率。


### 批次：2026-11-09（机制：交付门、诊断与实测订正）

> 本批原以「不升版号」记在 `main` 上，随 0.3.1 一并发布。这一批换的是「机制」，不是规则文本。

#### 新增：交付门 delivery-gate（默认关闭）

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

#### 变更：doctor 新增第 9 项检查

`scripts/doctor.mjs` 现在会**静态比对** profile 里每个 `@deepseek-ai/*` 包声明的精确版本要求与本机 dsh 版本，
对不上的直接判红并给出修法。原因是 dsh 挂载时会把版本不符的插件行**静默跳过**，只在 stderr 说一句
`disabling profile plugin row …`：用户看到的是「工具少了」，而不是「装错了」。

实测背景：headless profile 里的 `@deepseek-ai/dsh-tool-fs-search@0.2.1-rc.5` 就是这样丢了 `glob` / `grep`，
几十次 bench 跑批都没发现（32 条历史结果全部带这个偏差）。

#### 脚本：runDshCapture

`scripts/lib/run-dsh.mjs` 增加 `runDshCapture()`（`spawnSync`，同时拿 stdout/stderr），供需要读 stderr 的检查使用；
`execFileSync` 只回 stdout，而上面的告警只写在 stderr 上。

#### 否决：v4 候选规则「契约先行」与「长文阅读」（测过，不加）

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

#### 更正：压缩阈值是安全网，不是降本手段（注释与一处旧读数）

按 `thresholdTokens = min(window × thresholdRatio, pressureBudget)`（窗口 1,000,000），本预设 0.25 = 250k 才压缩。实测（2026-11-09）：**109 个运行的上下文峰值中位 20k、p90 34k、最大 126k，250k 从未触发**；把阈值压到 0.04（40k）在 O08 上跑，峰值 39.6k，照样一次没压缩 —— 因为 `tool-result-pruner` 已经把每次工具输出压到约 5.2k 字符。

同时更正一处口径：v4-bench 里「10/32 运行超 250k token」是**累计 token**（每次请求求和，含 cache 读），不是上下文峰值。

因此 `presets/*.patch.yml` 里那段注释改写为可核对的表述（原句「长会话里大量步数停在 300k 以上」在 109 次测量里没有出现过）。顺手测了真正起作用的旋钮（O01，n=4）：pruner 8192 → 2048 每次 token 中位 297k → 228k，但 office 床 Q 无分辨力，暂不下发布结论。
补测长文（LongBench lb2 8 题，n=1）走势相反：2048 反而从 66.9k 涨到 83.9k（截断后反复重读），准确率不变（两臂同 2/8）—— **pruner 也不是免费旋钮，保留 8192**。

另外更正一条判断：office 床「Q 没有分辨力」是错的 —— **同一题的交付物在四臂之间逐字节相同**（唯一差异是 CRLF），所以 Q 必然相同。这批题因此只能当成本基准。顺带得到一个读数：产出相同而 token 相差 **1.1–8.7 倍**（O08：568k / 939k / 1145k / 4918k），说明单题成本对比没有意义，成本结论必须跨题、够 n。


### 批次：2026-11-08（CI 与随包文档对账）

> 本批原以「不升版号」记在 `main` 上，随 0.3.1 一并发布。这批是 CI、脚本细节与随包文档的修正。

**只改 CI、脚本细节与随包文档：预设 id、规则文本、别名表、模型行为一律不动。**

这一批是 0.3.0 的「对账」—— 把第六轮审计里那些「本地过、CI 不过」和「文档写的不是事实」的条目一次清掉。

#### CI 收口（以前 CI 绿，不等于仓库闸门绿）

- `verify` job 现在直接跑 `npm run verify`（当时 10 个检查的唯一入口，这条链现在已经加到 12 个）。此前 CI 是逐项手抄，**漏了 `sync-lib --check`、`guard-bench-leak`、`verify-versions`、`render-bench-table --check` 四个** —— 也就是「`lib/` 忘了从 `plugins/plan-mode-ui/lib/` 同步」「版本号漂移」「基准表漂移」这几类问题在 CI 里完全看不见。
- 新增一步「发布面卫生与基准复核清单」：`verify-release-hygiene.mjs` + `bench-release-checklist.mjs`，这两个以前只挂在 `prepublishOnly` 上。
- 修掉一条**永远成立**的断言：卸载后检查的是 `preset-flash-lean-ptc-v2`，而安装器从 0.2.6 起就不写 v2 了；现在改查 `preset-flash-lean-ptc-v3`。
- 新增探针 `tools/probe/alias-vs-config.mjs`（也可 `npm run verify:alias`）：把别名表与**真实组合配置**对一遍 —— CI 里喂 `dsh --profile ci --dump-config` 的输出，断言别名指向的 id 真的在配置里、`flash-presets-alias` 行真的在。0.2.8 → 0.2.9 那次事故的形状（会话里的 id 解析到包内不存在的定义）从此有闸门。
- 仍然不能自动化的：真实「建会话 → 升级 → resume」需要能跑模型的 provider，CI 没有凭据，继续留在人工检查单（见《审计索引》第 7 节）。

#### 新 lint 规则：随包文档的陈述对账

`scripts/lint-presets.mjs` 增加「2.5 陈述对账」：把 lite 说成默认卡的说法直接判红；同一行里既有「待发 / 未发布」又出现**当前版本号**也判红（历史章节与变更日志本身不受影响）。

规则上线当场抓到一条：`docs/审计索引-0.2.9.md` 还写着「0.3.0 待发」，已改成三通道发齐。

#### 文档对账

- `README.en.md`：「today's lite」改成「today's `flash-lean-ptc-v3` (lean-v3)」；`-lite` 的区间由「0.2.7–0.2.8」改成「0.2.6–0.2.8」（`git ls-tree v0.2.6 presets/` 可复现）。
- `cordis.patch.yml` 与 `scripts/compose-bundle-patch.mjs` 的注释：「历史 id」由 3 个改成 **5 个**（`v3-lite / v1 / v2 / flash-lean-ptc / flash-lean`），与 `lib/preset-alias.js` 的别名表一致。
- `CHANGELOG` 里关于 `npm deprecate` 的旧叙述订正：标记早已补上（`npm view dsh-flash-presets@0.2.5 deprecated` 可复现），原文依赖的 Automation token 已随 npm 收紧 bypass-2FA 失效。
- `CONTRIBUTING.md`：删掉「本仓库是纯补丁层，没有运行时代码」这句错话 —— 仓库确实带运行时（`lib/`），且**真源在 `plugins/plan-mode-ui/lib/`**，改运行时只能改真源。
- `plugins/plan-mode-ui/NOTICE.md`：「64 项自测」改成「26 个测试文件」（`bash test/run.sh` 的实测输出）。
- `README` 的「更新与卸载」写清升级语义：用精确版本安装后 `dsh plugin update` **不会**自动升级，升级 = 再 `add` 一次新版本；并说明 pnpm 留下的 `minimumReleaseAgeExclude` 行是正常的。

#### 脚本小修

- `tune-runtime --check` 以前会被当成未知参数拒绝（而它自己的用法行就写着 `[--check]`），现在接受；与 `--apply` / `--revert` 同时给出时明确报错退出 2。
- `install.ps1` 退出时还原 `$env:DSH_HOME`（dot-source 或交互式调用不再污染调用者会话）。
- `publish.sh`：Release 附件**每次重打**（以前 `dist/` 里有同名 zip 就直接复用，容易传上旧内容）；删掉「临时放宽 tag 规则集 → `git tag -f`」的错误指引，与「已发布的 tag 永不移动」保持一致。
- `publish.ps1`：仓库描述文案由「v1/v2 预设」改成「v3 十三条 / v3 balance 三条」。

#### 兼容性

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