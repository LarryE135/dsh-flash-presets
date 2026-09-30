# DSH Flash 精简预设

**当前版本：v0.2.0**（2026-09-30 · 精简 PTC 预设分 v1/v2 两版，附 8 用例基准数据与端到端自测）

[![verify](https://github.com/LarryE135/dsh-flash-presets/actions/workflows/verify.yml/badge.svg)](https://github.com/LarryE135/dsh-flash-presets/actions/workflows/verify.yml)

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）准备的两个 agent 预设，面向 **flash 级路由**做 token 效率优化：

- **`flash-lean-ptc-v2`** — 现行推荐（适配0.2.0版本，理论向下兼容）。PTC 工具面（所有工具经 `run_code` 编程式调用）+ 12 条行为硬约束；压缩阈值 0.25 / 保留 20k，并加了步数预算（≤20 步）、少想多试、一次合并验证、先交最小可行产物、PTC 打包指引。
- **`flash-lean-ptc-v1`** — v1 基线（适配0.1.7及以前版本）。同为 PTC 工具面 + 14 条硬约束，压缩阈值 0.3 / 保留 50k；保留用于对照与回退。

前言：
结合AA榜单上的Token efficiency和日常使用不难看出，Deepseek v4.1 flash在有过渡思考倾向的同时，意图理解较差（注意，不是指令遵从度）。在喜闻乐见的MC Benchmark中，作者仅在新的提示词中加上一句“这是一个新项目，不要参考已有的项目”，模型就直接理解为不能选用Three.js这样成熟的技术栈（且完全没有征求我的意见），而是选择自研WebGL引擎，一连开了两个对话都是这样（供应商为官方）。加上v4.1flash能力并不差，容易给人一种“时神时鬼”的感觉。实际使用时除了Linux环境外，v4.1f高度依赖准确的提示词或其他能力更强模型的指导。

特点：
通过卡预算和增加约束的方式避免在所有任务上都进行“雷霆大思考”，对于能力范围内的任务，本预设可以用比标准或PTC预设更低的预算完成任务，且基本维持产出质量，比较适合用于难度不高的日常事务（lean-ptc效果最好）。

**BENCH-STD 同批三臂对照**（8 用例 = 3 道算法题 + 5 个工具探针；计费输入单位 M tokens）

| 批次 | 用例 | 标准 | 精简·PTC v1 | 精简·PTC v2 |
|---|---|---|---|---|
| ① 官方 | p14833 构造 + p15264 大数据构造 | 61.9M | 37.9M（−39%） | **11.2M（−82%）** |
| ② 官方 | p17244 提交答案型（n=3 中位） | 3.9M | 3.7M（−7%） | **2.0M（−50%）** |
| ③ 第三方 | p14833 构造 + probe1 批量读取 | 37.6M | 14.3M（−62%） | **7.9M（−79%）** |

> 判分：以上交付单元全部满分（含官方隐藏测试与大数据形态测试）。同批内可比、跨批不可比；
> 批次③里 p15264 三臂判负或未交付、p17244 的 v2 臂被中途中止，均未计入。

可以看到，在面对明确超出能力的题（竞赛级、需要交付尽可能多部分分），标准预设更值得——它至少保证"写得出、交得上"；而本预设适合圈内任务——同批实测省 50–80% 且判分不掉；高难题侧的代价参考：USACO 2026 Platinum 两轮合计，标准 51.5/80 分、51.4M，精简·PTC 47.5/80 分、48.0M（省 7% 成本但掉 8% 分）

这点对Oneshot样例也有效：
图一使用该预设（PTC 预设），报告的Token消耗为5.3M，耗时14m37s，42步
<img width="2559" height="1540" alt="屏幕截图 2026-09-22 205848" src="https://github.com/user-attachments/assets/c469f899-3433-4afd-a931-1e160c1f95b1" />
<img width="1877" height="1598" alt="屏幕截图 2026-09-22 205905" src="https://github.com/user-attachments/assets/b12c0dcb-8700-4099-a876-ac2dcfe5fd4d" />

图二使用PTC模式，报告的Token消耗为8.3M，耗时40m45s，60步（环境均为WSL，先执行特殊预设，且工具链一致）
<img width="2559" height="1539" alt="屏幕截图 2026-09-22 205636" src="https://github.com/user-attachments/assets/9d35dc3c-1f3f-4abd-b51e-ec62772da890" />
<img width="1901" height="1599" alt="屏幕截图 2026-09-22 205702" src="https://github.com/user-attachments/assets/e9db03d9-52e9-45cb-b225-56d4cd57d6c3" />

总而言之，这两个预设会抑制模型过渡思考的倾向，转而表现出较高的指令遵从度。其意义是在特定场景下（如上述算法题、或指令明确的长任务中），在维持模型能力水平的同时，可以同时减少Token和步数（对"反复跑一小段、看输出、再跑"的增量式折腾尤其有效）。此外本预设还通过修改压缩逻辑优化了长会话下模型的注意力衰减，对长任务居多的人这点反而体感更明显。

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
bash scripts/selftest.sh                 # 端到端自测：版本口径/安装-幂等-卸载逐字节还原/legacy/发布守卫（19 项）
node scripts/check-ps1.mjs               # PowerShell 脚本静态审查：预设名单、tag 守卫、BOM（无需 pwsh）
```

看排在最前面的 `[安装] 检测到: …` 一行即可确认当前生效的是哪种机制：

- `插件行式（…/profiles/web/cordis.patch.yml）` → 0.1.7+；
- `旧版目录式（…/.agent-presets）` → 旧版 DSH。

还可以直接问 DSH 组合结果对不对：

```bash
dsh --profile web --dump-config | grep -A3 'id: preset-flash-lean-ptc-v2'
```

Windows 上若 `DSH_HOME` 不是默认值（默认 `%USERPROFILE%\.dsh`）：

```powershell
$env:DSH_HOME = "$env:USERPROFILE\.dsh"
node scripts\verify-presets.mjs
```

CI（ubuntu / windows / macos）除两种安装机制外，也会跑 `bash scripts/selftest.sh` 与 `node scripts/check-ps1.mjs`。
上面的脚本都是纯 Node 或纯 shell，在 Windows / macOS / Linux 上行为一致；`js-yaml` 会自动从仓库 `node_modules`、
全局 DSH 安装位置或 `npm root -g` 中查找，也可以用 `DSH_JS_YAML` 直接指定。

装好后预设列表里会出现「Flash 精简·PTC v1（v4.1-flash）」与「Flash 精简·PTC v2（v4.1-flash）」
（0.1.7+ 的 web profile 无需重启，刷新页面即可）。

---

## 如何选择？

| | `flash-lean-ptc-v1` | `flash-lean-ptc-v2` |
|---|---|---|
| 定位 | 基线与对照，行为最可预测 | 现行推荐：多题、多文件、脚本密集型任务 |
| 工具面 | 工具统一走 `run_code`，一个程序里组合多步调用 | 同左，另加「同一步的多个独立调用打包进一个程序」的指引 |
| 压缩 | 阈值 0.3 / 保留 50k / 重试 2 | 阈值 0.25 / 保留 20k / 重试 1 |
| 硬约束 | 14 条 | 12 条（去掉子代理契约与检查点，加步数预算与一次合并验证） |
| 实测成本（同批对照） | 官方 p14833 4.22M、p15264 33.64M、p17244 3.65M | 官方 **1.72–4.24M / 6.97–11.96M / 1.62–1.95M** |
| 代价 | 步数更多；长任务上比 v2 贵约 2–5 倍 | 极短任务（≤3 步）收益≈0 |

**选择依据只有一条**：这条任务会不会诱发"反复跑一小段、看输出、再跑"的增量式折腾。会 → 收益最大；不会 → 收益≈0。
两者都不改变答案质量。

---

## 关键配置

基座 = 新版出厂的 **`ptc` 预设**（PTC 工具面、`delegation/workflow-ptc` 等来自基座本身）。独立审计实测：相对基座 **3 行差异**，相对 `standard` 预设 **7 行**（多出的 4 行是 PTC 工具面带来的，不能按 3 处口径类比）：

| 行 | 标准预设 | `flash-lean-ptc-v1` | `flash-lean-ptc-v2` |
|---|---|---|---|
| `persona` | 只有两行（身份 + 工作目录） | 另加 14 条 PTC 硬约束 | 另加 12 条（含步数预算、一次合并验证、PTC 打包指引） |
| `compaction-basic` | 用默认（`thresholdRatio` 0.8，约等于声明窗口的 80%） | 0.3 / 保留 50k / 重试 2 | 0.25 / 保留 20k / 重试 1 |
| `tool-workflow` / `delegation/workflow-ptc` | 启用 | `disabled: true`（`tool-ralph` 在出厂 `standard` 里本就停用，不构成差异） |
| `tool-result-pruner` | 默认 8192/4096/1024 | **保持不变**（收紧阈值实测会亏，见下） |

压缩阈值是 `floor(声明窗口 × thresholdRatio)`：本预设按"声明 1,000,000 窗口"的路由调过，阈值≈300k。
换到声明窗口更小的路由时，请按同样比例（约 30% 窗口）重新评估。

---

## 行为约束（v1 14 条 / v2 12 条）

**v1（14 条）**：工具选择（用 read/glob/grep，不用 bash 浏览）· 读预算（同一路径一个阶段只读一次）· 输出预算（批量调用、截断长输出、单条结果 ≤4 KB）·
增量建模文件（先建骨架再 edit）· 证据优先（"通过"必须附本轮命令与关键输出）· 验收优先（先列验收点再实现）· 检查点（约每 40 次调用停下汇报）·
语言与范围 · 子代理契约 · 上下文纪律 · 转录敏感度 · payload 安全（大 payload 落盘再读）· 读与改分成两个程序 · 每个程序输出保持小。

**v2（12 条）**：在 v1 基础上删掉「检查点」与「子代理契约」（实测这两条只推高步数），改为：
先给预算（≤20 步，交付物过检查即停）· 少想多试（短推理 + 一条廉价取证）· 每个交付物只做一次合并验证 ·
提交答案型任务先交最小可行产物 · 把同一步的多个独立调用打包进一个 `run_code` 程序（单次调用则直接调）。
上下文纪律、转录敏感度、输出预算、安全条款原样保留。

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

| 题库族 | 规模 | 标准预设 | 精简（评测版，已下线） | 精简·PTC（评测版，已下线） |
|---|---|---|---|---|
| 自出 easy | 6 题 | 1.22M | 1.33M | **0.42M** |
| 自出 hard | 4 题（矩阵快速幂/后缀自动机/懒标记线段树/斜率优化） | 2.60M | 0.77M | **0.32M** |
| LiveCodeBench hard（官方隐藏测试） | 4 题 × 40 组 | 5.73M | 5.97M | **2.44M** |
| USACO 官方数据（特制 checker） | 1 题 × 14 组 | 0.81M | **0.51M** | — |
| 长会话（35 轮） | 1 条 | 31.58M | 17.29M | — |

外部题库的质量项：4 题 160/160 官方隐藏测试全部通过（三条臂均满分）；校正 checker 后 USACO 14/14。
后续会考虑增加难度更高的测试题目

### 基准测试 BENCH-STD（2026-09-30）

8 个用例 × 多臂、**同批对照**（批次之间同预设可差 4–9 倍，因此只比同批）：3 道算法题 + 5 个工具型探针
（批量读取、大数据、循环、修复、检索）。质量项含隐藏测试与大数据形态测试；**已交付单元判分全部满分**（个别单元未交付或判负，见下方两处注）。

**官方路由**（每格 1–4 次运行）：

| 用例 | standard | 评测 v1 基线（11 条冻结版） | v2 |
|---|---|---|---|
| p14833 构造 | 12.40M | 4.22M | **1.72M** |
| p15264 大数据构造 | 37.24M / 53.79M | 33.64M | **11.96M / 6.97M** |
| p17244 提交答案型 | 2.56M（另一批 n=1）/ 3.92M[3.18–8.81]（n=3） | 3.65M[1.49–5.83]（n=3） | **1.62M（另一批 n=1）/ 1.95M[0.90–2.12]（n=3）** |

> **v1 列的口径**：表里 v1 的数字来自评测用的冻结版 `frozen/lean-ptc-v1.yml`（11 条规则，仅用于基准）。
> 仓库出货的 `flash-lean-ptc-v1` 是 GUI 版（14 条规则，0.1.x 的 `flash-lean-ptc` 延续），二者不是同一份文件；
> 出货 v1 未单独跑基准，需要时可补测（已在待办里）。

**第三方路由**（同批三臂）：p14833 37.48M → v1 14.23M → **v2 7.84M**；
probe1 0.11M → **0.04M（v1）** → 0.05M（v2）；p17244 standard 8.03M、v1 3.98M（v2 仓在该批被中止，未交付，不计入）。
注：p15264 在该路由上 standard 未交付、v1/v2 判负（该题在此路由交付不稳），不以单题结果判断预设差异。

**结论**：v2 相对 standard 在官方路由上为 **0.13×–0.63×**（取表内最省/最费配对）；
同批 p14833 上 v1 4.22M ≈ v2 4.24M（≈1.0×，探测型任务持平）；长任务上（p15264 6.97 vs 33.64M、p17244 1.95 vs 3.65M）v2 更低，
但这两组是**跨批配对**，幅度里含批次差 —— 方向可信、倍数不可当精确值。

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

- 成本数据多数为每臂 1 次运行（隔离实验 3 次重复；2026-09-30 基准里 p17244 达 n=4）。方向可信、幅度有噪声；
  **跨批次同预设可差 4–9 倍**，请只用同批对照结论。
- 三个题库族的金标准解由同一模型族撰写（用大时间余量 + 数千次随机对拍证明其正确，但不是独立第三方实现）。
- 未覆盖：真实 GPU/渲染负载、联网检索型任务、多子代理扇出（`flash-fanout` 不在本仓库）。
- 规则 7（每约 40 次调用停下汇报）在实测里会被长任务拖过去，属于"最好情况下的纪律"，不是硬保证。

---

## 仓库结构

```
dsh-flash-presets/
├── presets/
│   ├── flash-lean-ptc-v2.patch.yml       # 0.1.7+ 插件行式（基座 = 新版 ptc）· 现行推荐
│   ├── flash-lean-ptc-v1.patch.yml       # 0.1.7+ 插件行式 · v1 基线（对照/回退）
│   └── legacy-0.1.5/flash-lean-ptc-v1/   # 旧版目录式（DSH < 0.1.7 回退用，仅提供 v1）
│       └── {preset.yml,agent.cordis.yml}
├── scripts/
│   ├── install.sh / install.ps1          # 安装/卸载（bash / PowerShell，行为一致，自动选机制）
│   ├── merge-presets.mjs                 # 两种安装器共用的补丁合并器（托管块插入/替换/移除）
│   ├── verify-presets.mjs                # 结构 + 跨平台回归 + 安装形态检查（无依赖）
│   ├── verify-yaml.mjs                   # YAML 解析 + 取值断言（需 js-yaml）
│   ├── selftest.sh                       # 端到端自测（安装/幂等/卸载/legacy/发布守卫，19 项）
│   ├── check-ps1.mjs                     # PowerShell 脚本静态审查（预设名单/BOM/tag 守卫）
│   └── publish.sh / publish.ps1          # 推送到 GitHub（+ Release）
├── .github/workflows/verify.yml          # CI：ubuntu / windows / macos 三系统 × 新旧安装机制 × 自测
├── .gitattributes                        # 行尾规范（*.sh 钉 LF，Windows 克隆后仍可直接 bash）
├── .gitignore
├── LICENSE
└── README.md
```

## 版本历史

> **版本口径**：本仓库按插件语义化版本记述 —— 起始 **0.1.0**，本次 **0.2.0**。
> 0.1.0 之前的提交用的是另一套标签（`v1.0.0` / `v1.0.1` / `v1.1.0`），内容都归入 0.1.0 这一代；
> 远端另有一个独立的 `v0.1.0` 标签指向同一代内容 —— 取用早期文件按这些标签取即可。

### v0.2.0（2026-09-30）
- **精简 PTC 预设分版**：`flash-lean-ptc-v1`（基线：压缩 0.3/50k/2、14 条约束）与
  `flash-lean-ptc-v2`（新：0.25/20k/1、12 条约束，加步数预算 / 少想多试 / 一次合并验证 / 先交最小可行产物 / PTC 打包指引）。
- **移除非 PTC 的「Flash 精简」**：`presets/flash-lean.patch.yml` 与旧式目录 `legacy-0.1.5/flash-lean/` 均删除，legacy 仅保留 v1。
- **README 新增基准数据**（BENCH-STD：3 算法题 + 5 探针，两条路由的同批三臂对照），并把「如何选择」改为 v1 vs v2 的对照。
- **自带端到端自测**：新增 `scripts/selftest.sh`（19 项：版本口径 / 安装-幂等-卸载逐字节还原 / legacy / 发布守卫）与
  `scripts/check-ps1.mjs`（无 pwsh 也能审 PowerShell 脚本），CI 三平台都会跑；Windows 侧已在 PowerShell 5.1 与 7.6 上实跑。
- 校验器与 CI 同步：断言两版各自的规则条数与压缩参数、行 id/order（21/22）、legacy 只校验 v1。

### v0.1.0（2026-09-23 ~ 09-24 · 首个发布）
- **适配 DSH 0.1.7-rc.1 的预设机制改版**：预设从「每预设一个目录」改为「插进 profile 用户补丁层的插件行」
  （`@deepseek-ai/dsh-agent-preset`）；旧目录在新版被忽略，预设重新生成为 `presets/*.patch.yml`，
  并保留 `presets/legacy-0.1.5/` 供旧版 DSH 使用；基座换成新版出厂的 `ptc` 预设（相对它 3 行差异，相对 `standard` 7 行）。
- **安装器重写**：自动识别机制（0.1.7+ 写补丁托管块 / 旧版复制目录）、可重复执行，支持 `--profile` / `--legacy` / `--uninstall`；
  bash 与 PowerShell 两侧共用同一个 Node 合并器 `scripts/merge-presets.mjs`。
- **Windows 可用性**：`verify-yaml.mjs` 改用 `fileURLToPath`（原先在 Windows 上拼出 `D:\D:\…`）；新增 `install.ps1` / `publish.ps1`，Windows 不再需要 bash。
- `.gitattributes` 钉住行尾（shell/node 走 LF，PowerShell 走 CRLF），避免 Windows 克隆后 `install.sh` 报 `bad interpreter`；
  `js-yaml` 查找顺序扩展到 Windows 布局与 `npm root -g`。
- CI 从单系统扩为 **ubuntu / windows / macos** 三系统矩阵，覆盖新旧两种安装机制；仓库更名为 `dsh-flash-presets`。
- 最初发布：`flash-lean`（11 条规则 + 阈值 0.3 + 停用 workflow/ralph）与 `flash-lean-ptc`（+ PTC 工具面与 3 条 PTC 规则）
  以及两套校验脚本；注释里保留实测数字，已剔除本机路径、私有评测引用与特定 provider 名称。
## English summary

Two DSH agent presets for flash-class routes, both exposing the PTC tool surface (all tools called
programmatically through `run_code`):

- **`flash-lean-ptc-v2`** (recommended): compaction at 0.25 with 20k retained, plus 12 hard behavioural
  rules - a step budget (<=20), thinking less and probing sooner, one consolidated verification per
  deliverable, ship the smallest viable artifact first, and pack independent tool calls into one program.
- **`flash-lean-ptc-v1`** (baseline): compaction at 0.3 with 50k retained and 14 rules; kept for
  comparison and rollback.

The non-PTC `flash-lean` preset was removed in v0.2.0 (use the 0.1.0-generation tags if you still need it).
Measured on the BENCH-STD suite (3 algorithm tasks + 5 tool probes, same-batch A/B): on the official
route v2 costs 0.13x-0.63x of the stock `standard` preset; against the 11-rule evaluation baseline it is
about 1.0x on probe-sized tasks and 2-5x cheaper on long tasks (cross-batch pairing: direction only).
Every delivered unit scored full marks. Install with `bash scripts/install.sh`; both presets are
inserted into the profile patch file and hot-reload on the `web` template.
