# DSH Flash 精简预设

[![verify](https://github.com/LarryE135/dsh-flash-presets-/actions/workflows/verify.yml/badge.svg)](https://github.com/LarryE135/dsh-flash-presets-/actions/workflows/verify.yml)

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）准备的两个 agent 预设，面向 **flash 级路由**做 token 效率优化：

- **`flash-lean`** — 日常主力。压缩阈值下调到 300k 级 + 11 条行为硬约束 + 砍掉两个从未被调用的工具行。
- **`flash-lean-ptc`** — 同上，另加 PTC 工具面（所有工具经 `run_code` 编程式调用）与 3 条 PTC 专属规则。

这两个预设**不改变模型能力，只改变"怎么花 token、怎么约束行为"**：在自建评测的三个题库族里质量全部满分
（含外部题库 LiveCodeBench 4 题 × 40 组官方隐藏测试、USACO 官方数据 + 特制 checker），
而计费输入降到标准的 **30%–70%**（多题算法任务上 PTC 最低到 **−88%**）。

**当前版本：v1.0.0**（2026-09-23）

---

## 快速开始

### 安装

```bash
git clone https://github.com/LarryE135/dsh-flash-presets-.git
cd dsh-flash-presets
bash scripts/install.sh                 # 安装到 ~/.dsh/.agent-presets/
# 自定义 DSH 目录：DSH_HOME=/path/to/.dsh bash scripts/install.sh
```

`install.sh` 会把 `presets/<name>/`（`preset.yml` + `agent.cordis.yml`）复制到 `$DSH_HOME/.agent-presets/<name>/`；
若目标已存在同名预设，会先备份为 `<name>.bak-<时间戳>`，可重复执行。

### 校验

```bash
node scripts/verify-presets.mjs          # 无依赖，24 项结构检查
npm install --no-save js-yaml@4
node scripts/verify-yaml.mjs             # YAML 解析 + 关键取值断言
```

随后重启 DSH（或刷新 GUI），预设列表里会出现「Flash 精简」和「Flash 精简·PTC」。

---

## 两个预设怎么选

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

## 为什么是这些数字（实测依据）

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

---

## 兼容性

- 在 **DSH 0.1.5-rc.2** 上实测；预设文件是从该版本的 `standard` / `ptc` 预设整份复制的，行 id 与插件名必须与目标部署一致。
  若目标部署缺少某个插件行导致挂载失败，删掉该行即可（`disabled: true` 的行删掉只影响"少了哪些工具"）。
- **PTC 在 headless 下需要显式开启**：交互式由 `tool-presentation: {mode: ptc}` 生效，
  `dsh --profile headless` 下必须设 `DSH_TOOLS_MODE=ptc`，否则仍是标准工具面。
- 未绑定任何 provider/模型；路由不同（尤其是声明窗口不同）时，压缩阈值请按"约 30% 声明窗口"重新评估。

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
│   ├── flash-lean/{preset.yml,agent.cordis.yml}
│   └── flash-lean-ptc/{preset.yml,agent.cordis.yml}
├── scripts/
│   ├── install.sh            # 安装到 $DSH_HOME/.agent-presets/
│   ├── verify-presets.mjs    # 结构检查（无依赖）
│   └── verify-yaml.mjs       # YAML 解析 + 取值断言
├── .github/workflows/verify.yml
├── LICENSE
└── README.md
```

## 版本历史

### v1.0.0（2026-09-23）
- 首次发布：`flash-lean`（11 条规则 + 阈值 0.3 + 禁用 workflow/ralph）与 `flash-lean-ptc`（+ PTC 工具面与 3 条专属规则）。
- 附带两套校验脚本与 CI；注释保留实测数字，已剔除本机路径、私有评测引用与特定 provider 名称。

## 打包

```bash
mkdir -p dist && rm -f dist/dsh-flash-presets-v1.0.0.zip
git archive --format=zip -o dist/dsh-flash-presets-v1.0.0.zip HEAD
```

## 发布到 GitHub

一条命令（推荐先 `gh auth login`）：

```bash
bash scripts/publish.sh          # 自动建仓库 + 推 main/tag + 发 Release
# 覆盖默认值：GH_USER=you REPO=name VISIBILITY=private bash scripts/publish.sh
```

没有 gh 时先手工建仓库再推：

```bash
git remote add origin https://github.com/LarryE135/dsh-flash-presets-.git
git push -u origin main
git push origin v1.0.0        # 密码位填 Personal Access Token
```

## 许可

MIT，见 [LICENSE](LICENSE)。`presets/` 下的组合文件派生自 DSH 自带的 agent 预设
（`@deepseek-ai/dsh-agent-presets`，MIT，© 2026 DeepSeek）：除上表列出的 4 处外，其余组合按原样保留。

---

## English summary

Two DSH agent presets tuned for token efficiency on flash-class routes. `flash-lean` lowers the
auto-compaction threshold to ~30% of the declared context window, adds 11 hard behavioural rules,
and disables two tool rows that were never called; `flash-lean-ptc` adds the PTC tool surface
(`run_code`-only) plus three PTC-specific rules. Measured across four task families, answer quality
stayed at full marks (including 4 LiveCodeBench problems × 40 official hidden tests) while billed
input fell to 30–70% of the standard preset. Install with `bash scripts/install.sh`, verify with
`node scripts/verify-presets.mjs`. MIT.
