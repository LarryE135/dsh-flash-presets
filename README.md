# DSH Flash 精简预设

**当前版本：v1.1.0**（2026-09-24 · 适配 DSH 0.1.7-rc.1 的预设机制改版）

[![verify](https://github.com/LarryE135/dsh-flash-presets/actions/workflows/verify.yml/badge.svg)](https://github.com/LarryE135/dsh-flash-presets/actions/workflows/verify.yml)

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）准备的两个 agent 预设，面向 **flash 级路由**做 token 效率优化：

- **`flash-lean`** — 日常主力。压缩阈值下调到 300k 级 + 11 条行为硬约束 + 砍掉两个从未被调用的工具行。
- **`flash-lean-ptc`** — 同上，另加 PTC 工具面（所有工具经 `run_code` 编程式调用）与 3 条 PTC 专属规则。

结合AA榜单上的Token efficiency和日常使用不难看出，Deepseek v4.1 flash在有过渡思考倾向的同时，意图理解较差（注意，不是指令遵从度）。在喜闻乐见的MC Benchmark中，作者仅在新的提示词中加上一句“这是一个新项目，不要参考已有的项目”，模型就直接理解为不能选用Three.js这样成熟的技术栈（且完全没有征求我的意见），而是选择自研WebGL引擎，一连开了两个对话都是这样（供应商为官方）。加上v4.1flash能力并不差，容易给人一种“时神时鬼”的感觉。实际使用时除了Linux环境外，v4.1f高度依赖准确的提示词或其他能力更强模型的指导。

基于这两周的历史对话（大概25etoken），本仓库给出了两个特化的精简预设：
这两个预设**不改变模型能力，只改变"怎么花 token、怎么约束行为"**：在自建评测的三个题库族里质量全部满分
（含外部题库 LiveCodeBench 4 题 × 40 组官方隐藏测试、USACO 官方数据 + 特制 checker），
而计费输入降到标准的 **30%–70%**（多题算法任务上 PTC 最低到 **−88%**）。

直接地讲，这两个预设会抑制模型过渡思考的倾向，转而表现出较高的指令遵从度。其优点是在特定场景下（如上述算法题、或指令明确的长任务中），在维持模型能力水平的同时，可以同时减少Token和时间的消耗（对"反复跑一小段、看输出、再跑"的增量式折腾尤其有效），同时通过修改压缩逻辑提高了长会话的注意力。

缺点也同样明显，在该预设可以视作通过“卡预算”的方式减少了思考的边际效益，在Oneshot样例中，使用一样的提示词时，通常会输出更少的Token。但是在这样的短会话中，如果模型本身的过度思考并不明显，就会变成花了更少Token办了更少事，且两者在效率上的差距并不明显：

图一使用该预设（lean-PTC），报告的Token消耗为5.3M，耗时14m37s，42步
<img width="2559" height="1540" alt="屏幕截图 2026-09-22 205848" src="https://github.com/user-attachments/assets/c469f899-3433-4afd-a931-1e160c1f95b1" />
<img width="1877" height="1598" alt="屏幕截图 2026-09-22 205905" src="https://github.com/user-attachments/assets/b12c0dcb-8700-4099-a876-ac2dcfe5fd4d" />

图二使用PTC模式，报告的Token消耗为8.3M，耗时40m45s，60步（环境均为WSL，先执行特殊预设，且工具链一致）
<img width="2559" height="1539" alt="屏幕截图 2026-09-22 205636" src="https://github.com/user-attachments/assets/9d35dc3c-1f3f-4abd-b51e-ec62772da890" />
<img width="1901" height="1599" alt="屏幕截图 2026-09-22 205702" src="https://github.com/user-attachments/assets/e9db03d9-52e9-45cb-b225-56d4cd57d6c3" />

可以看到，尽管使用本预设的速度更快（权衡之后效益也更高），但是实际产出确实没有弱约束好（抽到好卡了.jpg），故使用本预设依旧依赖准确的提示词，或依赖能力更强的模型来完成技术选型，是一种偏向于保下限的做法。如果你期望这个插件能让Oneshot小垃圾效果更好，那你大抵要失望了。

---

## 快速开始

### 安装

> **DSH 0.1.7-rc.1 起预设机制变了**：旧的 `~/.dsh/.agent-presets/<id>/` 目录**不再被读取**，
> 预设现在是插进 profile 用户补丁层的插件行（`@deepseek-ai/dsh-agent-preset`）。
> 本仓库同时提供两种形态，安装器会**按你的 DSH 自动选择**。

```bash
git clone https://github.com/LarryE135/dsh-flash-presets.git
cd dsh-flash-presets
```

**Linux / macOS / WSL / Git Bash**

```bash
bash scripts/install.sh                        # 0.1.7+ 写 profile 补丁；旧版自动回退到目录式
bash scripts/install.sh --profile headless      # 指定 profile（默认 web）
bash scripts/install.sh --legacy                # 强制旧版目录式
bash scripts/install.sh --uninstall             # 卸载（移除托管块）
DSH_HOME=/path/to/.dsh bash scripts/install.sh  # 自定义 DSH 主目录
```

**Windows（PowerShell 5.1+ 或 PowerShell 7）**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install.ps1
.\scripts\install.ps1 -Profile headless        # 指定 profile
.\scripts\install.ps1 -Legacy                  # 强制旧版目录式
.\scripts\install.ps1 -Uninstall               # 卸载
.\scripts\install.ps1 -DshHome D:\tmp\.dsh     # 自定义 DSH 主目录
```

两者的行为完全一致（共用同一个 Node 合并器 `scripts/merge-presets.mjs`）：

| 你的 DSH | 安装动作 | 生效方式 |
|---|---|---|
| **≥ 0.1.7-rc.1** | 把两个预设的 `- insert:` 条目写进 `<DSH_HOME>/profiles/<profile>/cordis.patch.yml` 的**托管块**里 | `web` 模板是 **live reload**：无需重启，刷新 GUI 即出现；其它模板需重启 |
| **< 0.1.7** | 复制 `presets/legacy-0.1.5/<name>/` 到 `<DSH_HOME>/.agent-presets/<name>/` | 重启 DSH |

安装器**可重复执行**：先备份 `cordis.patch.yml.bak-<时间戳>`，再整块替换（不会出现两份）；
目录式安装则把已存在的同名预设改名备份。要求 Node 在 PATH 上（DSH 本身依赖它）。

### 校验

```bash
npm install --no-save js-yaml@4          # verify-yaml 需要；verify-presets 无第三方依赖
node scripts/verify-presets.mjs          # 结构 + 跨平台回归 + 安装形态（自动识别新旧机制）
node scripts/verify-yaml.mjs             # YAML 解析 + 关键取值断言（阈值/规则条数/PTC 展示层…）
```

看排在最前面的 `[安装] 检测到: …` 一行即可确认当前生效的是哪种机制：

- `插件行式（…/profiles/web/cordis.patch.yml）` → 0.1.7+；
- `旧版目录式（…/.agent-presets）` → 旧版 DSH。

还可以直接问 DSH 组合结果对不对：

```bash
dsh --profile web --dump-config | grep -A3 'id: preset-flash-lean'
```

Windows 上若 `DSH_HOME` 不是默认值（默认 `%USERPROFILE%\.dsh`）：

```powershell
$env:DSH_HOME = "$env:USERPROFILE\.dsh"
node scripts\verify-presets.mjs
```

两个脚本都是纯 Node，在 Windows / macOS / Linux 上行为一致；`js-yaml` 会自动从仓库 `node_modules`、
全局 DSH 安装位置或 `npm root -g` 中查找，也可以用 `DSH_JS_YAML` 直接指定。

装好后预设列表里会出现「Flash 精简（v4.1-flash）」和「Flash 精简·PTC（v4.1-flash）」
（0.1.7+ 的 web profile 无需重启，刷新页面即可）。

---

## 如何选择？

| | `flash-lean` | `flash-lean-ptc` |
|---|---|---|
| 定位 | 长任务、多回合开发 | 需要"用脚本批量调用工具"的任务 |
| 工具面 | 标准工具面（read/write/edit/bash/glob/grep…） | 工具统一走 `run_code`，一个程序里组合多步调用 |
| 实测成本 | 长任务计费输入降 28%–47%；自出难题 −70%；USACO 单题 −37% | 多题算法任务 −57% ~ −88%，步数 −85% |
| 代价 | 任务不诱发浪费时收益≈0，甚至 +32% | 单步短任务里反而更贵（约 +30%） |
| 额外约束 | 11 条 | 14 条（+payload 安全、读写分离、程序输出预算） |

**选择依据只有一条**：这条任务会不会诱发"反复跑一小段、看输出、再跑"的增量式折腾。会 → 收益最大；不会 → 收益≈0。
两者都不改变答案质量。

---

## 关键配置

与 DSH 自带 `standard` 预设相比，**只有 4 处差异**：

| 行 | 标准预设 | 本预设 |
|---|---|---|
| `persona` | 只有两行（身份 + 工作目录） | 另加 11 条硬约束（PTC 版 14 条） |
| `compaction-basic` | 用默认（`thresholdRatio` 0.8，约等于声明窗口的 80%） | `thresholdRatio: 0.3`、`retainTokens: 50000`、`compactionRetries: 2` |
| `tool-workflow` / `tool-ralph` | 启用 | `disabled: true`（模型可见工具 29 → 27） |
| `tool-result-pruner` | 默认 8192/4096/1024 | **保持不变**（收紧阈值实测会亏，见下） |

压缩阈值是 `floor(声明窗口 × thresholdRatio)`：本预设按"声明 1,000,000 窗口"的路由调过，阈值≈300k。
换到声明窗口更小的路由时，请按同样比例（约 30% 窗口）重新评估。

---

## 11 条行为约束（`flash-lean`）

工具选择（用 read/glob/grep，不用 bash 浏览）· 读预算（同一路径一个阶段只读一次）· 输出预算（批量调用、截断长输出、单条结果 ≤4 KB）·
增量建模文件（先建骨架再 edit，不重发已验证文件）· 证据优先（"通过"必须附本轮命令与关键输出）· 验收优先（先列出验收点再实现）·
检查点（约每 40 次工具调用或上下文过 250k 就停下汇报）· 语言与范围 · 子代理契约 · **上下文纪律**（不要长期驻留整份语料）·
转录敏感度（不要把密钥/私密原文写进会话，转录可被回读）。

`flash-lean-ptc` 另加：payload 安全（含反引号的文本不塞进 `String.raw`，大 payload 落盘再读）· 读与改分成两个程序 ·
每个程序输出保持小（结尾只打印 ≤40 行摘要，细节写日志）。

---

## 设计依据

所有数值都来自同一套 A/B 评测（同一 flash 级路由、同一批任务、同一网络条件；该路由声明 1,000,000 token 上下文窗口）。

**1）压缩阈值 0.8 → 0.3。** 声明 1,000,000 窗口时默认 0.8 意味着接近 800k 才压缩，而实测 20.3% 的步落在 300k 以上上下文、
吃掉 59.1% 的计费输入，工具报错率从 0.9%（<50k）升到 4.5%（>600k）。改成 0.3（阈值≈300k、保留 50k 尾部）后：
隔离实验重复 3 次 3 胜，中位 **−28%**；最终预设等价配置相对全默认对照中位 **−47%**。

**2）裁剪阈值保持默认。** 把 `tool-result-pruner` 收到 3000/1500/400 会把模型刚读进来的 3–8 KB 分页结果裁成 1.9 KB，
迫使它回头重读：步数 29 → 36–49、输出 3.2 万 → 5 万，把省下的钱吃回去（只降阈值 3/3 胜、中位 −28%；叠加激进裁剪仅 1/3 胜、中位 −4.5%）。
另外该裁剪器**由压缩压力门控**：阈值未触发时它一次也不工作。故本预设不动它。

**3）禁用两个工具行。** 10,731 步语料里 `tool-workflow`、`tool-ralph` 调用次数均为 **0**，而 `tool-workflow` 的工具定义
是全部工具定义字符里最大的一条（4,137 / 29,405）——每轮都要白付。

**4）11 条规则本身只值约 10%**（在噪声内）。真正的大杠杆是**上下文纪律**：同预设同任务下，
把"每轮只读新增内容、需要回看就用 grep/脚本重建"贯彻到底，计费输入从 31.58M 降到 5.45M（**−83%**）。
规则的作用是让这种纪律稳定发生，而不是靠模型自觉。

---

## 实测结果

质量与成本的完整对照（每格为一次运行的计费输入；质量项全部满分）：

| 题库族 | 规模 | 标准预设 | `flash-lean` | `flash-lean-ptc` |
|---|---|---|---|---|
| 自出 easy | 6 题 | 1.22M | 1.33M | **0.42M** |
| 自出 hard | 4 题（矩阵快速幂/后缀自动机/懒标记线段树/斜率优化） | 2.60M | 0.77M | **0.32M** |
| LiveCodeBench hard（官方隐藏测试） | 4 题 × 40 组 | 5.73M | 5.97M | **2.44M** |
| USACO 官方数据（特制 checker） | 1 题 × 14 组 | 0.81M | **0.51M** | — |
| 长会话（35 轮） | 1 条 | 31.58M | 17.29M | — |

外部题库的质量项：4 题 160/160 官方隐藏测试全部通过（三条臂均满分）；校正 checker 后 USACO 14/14。
后续会考虑增加难度更高的测试题目

---

## 跨平台支持

| 动作 | Linux / macOS / WSL / Git Bash | 原生 Windows |
|---|---|---|
| 安装 | `bash scripts/install.sh` | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install.ps1` |
| 结构校验 | `node scripts/verify-presets.mjs` | 同左（PowerShell 里用 `node scripts\verify-presets.mjs`） |
| YAML 校验 | `npm i --no-save js-yaml@4 && node scripts/verify-yaml.mjs` | 同左 |
| 推送 | `bash scripts/publish.sh` | `powershell ... -File scripts\publish.ps1` |
| DSH 主目录 | `$DSH_HOME` 或 `~/.dsh` | `$env:DSH_HOME` 或 `%USERPROFILE%\.dsh` |

CI 在 **ubuntu-latest / windows-latest / macos-latest** 三个 runner 上各跑一遍
「安装 → 两套校验」，所以任何"只在某个系统上坏"的问题会在 PR 阶段暴露。
`scripts/verify-presets.mjs` 另外带一组**回归守卫**：禁止 `import.meta.url).pathname`
（Windows 上会得到 `/D:/…`）、要求两种安装器都在、要求 `.gitattributes` 把 `*.sh` 钉为 LF。

## 兼容性

| DSH 版本 | 预设形态 | 说明 |
|---|---|---|
| **≥ 0.1.7-rc.1** | 插件行（profile 补丁里的托管块） | 预设机制改版：目录不再被读取；两个预设都以本版出厂的 `standard` / `ptc` 为基座，只保留 3 处 FLASH 差异（persona 规则、压缩阈值、停用 `tool-workflow`）。`web` 模板 live reload。 |
| **< 0.1.7** | 目录式（`.agent-presets/<id>/`） | 安装器自动回退；文件在 `presets/legacy-0.1.5/`，整份来自 0.1.5 的 `standard` / `ptc`。 |

- 行 id 与插件名必须与目标部署一致：若目标部署缺少某个插件行导致挂载失败，删掉该行即可
  （`disabled: true` 的行删掉只影响"少了哪些工具"）。
- **PTC 在 headless 下需要显式开启**：交互式由 `tool-presentation: {mode: ptc}` 生效，
  `dsh --profile headless` 下必须设 `DSH_TOOLS_MODE=ptc`，否则仍是标准工具面。
- 未绑定任何 provider/模型；路由不同（尤其是声明窗口不同）时，压缩阈值请按"约 30% 声明窗口"重新评估。
- 升级 DSH 后若出厂 `standard`/`ptc` 结构变了，重新生成即可：以新版
  `<dsh>/node_modules/@deepseek-ai/dsh-web-app/presets/{standard,ptc}.patch.yml` 为基座，套回上述 3 处差异。

---

## 已知限制

- 成本数据**每臂一次运行**（除"隔离实验"是 3 次重复），方向可信、幅度有噪声。
- 三个题库族的金标准解由同一模型族撰写（用大时间余量 + 数千次随机对拍证明其正确，但不是独立第三方实现）。
- 未覆盖：真实 GPU/渲染负载、联网检索型任务、多子代理扇出（`flash-fanout` 不在本仓库）。
- 规则 7（每约 40 次调用停下汇报）在实测里会被长任务拖过去，属于"最好情况下的纪律"，不是硬保证。

---

## 仓库结构

```
dsh-flash-presets/
├── presets/
│   ├── flash-lean.patch.yml              # 0.1.7+ 插件行式（基座 = 新版 standard）
│   ├── flash-lean-ptc.patch.yml          # 0.1.7+ 插件行式（基座 = 新版 ptc）
│   └── legacy-0.1.5/<name>/              # 旧版目录式（DSH < 0.1.7 回退用）
│       └── {preset.yml,agent.cordis.yml}
├── scripts/
│   ├── install.sh / install.ps1          # 安装/卸载（bash / PowerShell，行为一致，自动选机制）
│   ├── merge-presets.mjs                 # 两种安装器共用的补丁合并器（托管块插入/替换/移除）
│   ├── verify-presets.mjs                # 结构 + 跨平台回归 + 安装形态检查（无依赖）
│   ├── verify-yaml.mjs                   # YAML 解析 + 取值断言（需 js-yaml）
│   └── publish.sh / publish.ps1          # 推送到 GitHub（+ Release）
├── .github/workflows/verify.yml          # CI：ubuntu / windows / macos 三系统 × 新旧两种安装机制
├── .gitattributes                        # 行尾规范（*.sh 钉 LF，Windows 克隆后仍可直接 bash）
├── .gitignore
├── LICENSE
└── README.md
```

## 版本历史

### v1.1.0（2026-09-24）
- **适配 DSH 0.1.7-rc.1 的预设机制改版**：预设从"每预设一个目录"改为"插进 profile 用户补丁层的插件行"
  （`@deepseek-ai/dsh-agent-preset`）。旧目录在新版被忽略，这版把两个预设重新生成为
  `presets/*.patch.yml`，并保留 `presets/legacy-0.1.5/` 供旧版 DSH 使用。
- 基座换成新版出厂的 `standard` / `ptc` 预设，只保留 3 处 FLASH 差异；顺带修正 PTC 版里
  **重复的规则编号**（旧文件里出现两组 10./11.，现为连续 1–14）。
- 安装器重写：自动识别机制（0.1.7+ 写补丁托管块 / 旧版复制目录）、**可重复执行**、支持
  `--profile`、`--legacy`、`--uninstall`，并共用同一个 Node 合并器 `scripts/merge-presets.mjs`。
- 校验器覆盖两种形态（`[安装] 检测到: 插件行式 / 旧版目录式`），并新增"托管块完整性 / 规则编号连续 /
  组合阈值 / 本机路径泄漏"等断言；CI 增加旧版机制安装路径的回归。

### v1.0.1（2026-09-23）
- 修复 Windows 可用性：`scripts/verify-yaml.mjs` 用 `fileURLToPath` 取代
  `new URL(import.meta.url).pathname`（后者在 Windows 上得到 `/D:/…`，拼路径后变成 `D:\D:\…`，读文件 ENOENT）。
- 新增 `scripts/install.ps1`、`scripts/publish.ps1`：原生 Windows（PowerShell 5.1+）不再需要 bash。
- 新增 `.gitattributes`：`*.sh` 等源码钉为 LF，避免 Windows 克隆把 `install.sh` 换成 CRLF 后 bash 报 `bad interpreter`。
- `js-yaml` 查找顺序扩展到 Windows 布局（`%APPDATA%\npm`、`%ProgramFiles%\nodejs`）与 `npm root -g` 兜底。
- CI 从单系统扩为 **ubuntu / windows / macos** 三系统矩阵；`verify-presets.mjs` 增加跨平台回归守卫。
- 仓库更名为 `dsh-flash-presets`，README 徽章 / clone 地址 / `publish.sh|ps1` 默认仓库名同步更新（GitHub 侧旧地址自动重定向）。

### v1.0.0（2026-09-23）
- 首次发布：`flash-lean`（11 条规则 + 阈值 0.3 + 禁用 workflow/ralph）与 `flash-lean-ptc`（+ PTC 工具面与 3 条专属规则）。
- 附带两套校验脚本与 CI；注释保留实测数字，已剔除本机路径、私有评测引用与特定 provider 名称。

---

## English summary

Two DSH agent presets tuned for token efficiency on flash-class routes. `flash-lean` lowers the
auto-compaction threshold to ~30% of the declared context window, adds 11 hard behavioural rules,
and disables two tool rows that were never called; `flash-lean-ptc` adds the PTC tool surface
(`run_code`-only) plus three PTC-specific rules. Measured across four task families, answer quality
stayed at full marks (including 4 LiveCodeBench problems × 40 official hidden tests) while billed
input fell to 30–70% of the standard preset. Install with `bash scripts/install.sh`, verify with
`node scripts/verify-presets.mjs`. MIT.
