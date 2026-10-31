# 办公基准测试 v1 / 办公追加测试 v1

两个**虚构的日常办公数据处理套件**，用来横向比较模型在"给一堆杂乱的办公材料、要求产出特定格式交付物"这类任务上的表现。
题目全部是合成数据，不含真实个人信息。

| 对外名称 | 目录 | 包内版本 | 题目 | 定位 |
|---|---|---|---|---|
| 办公基准测试 v1 | `base-v1/` | `5.0.0`（原始标题 "v5"） | `O01`–`O08` | 主测：8 题，规则密度高、规模大 |
| 办公追加测试 v1 | `addendum-v1/` | `5.5.0`（原始标题 "v5.5"） | `P01`–`P05` | 快速回归：5 题，单题体量小、跑得快 |

> 对外叫 v1、包内是 5.x：因为这两个套件在作者那边是一起迭代到 v5/v5.5 的。**题号（`O*` / `P*`）不变**，
> 后续若出新的题集，套件名递增（v2…），包内版本保留原始编号，靠这张表对齐。

## 基准套（`base-v1/`，8 题）

| ID | 标题 | 规模 | 交付文件（基线行数） |
|---|---|---|---|
| O01 | 整理项目周报中的最新承诺 | 36 项目、216 份更新、108 个字段 | `status.csv`（108） |
| O02 | 月度报销核验与部门汇总 | 900 票据、1373 流水、6 部门 | `claims.csv`（900）、`summary.csv`（6） |
| O03 | 销售更正与退货月报 | 9559 修订事件、覆盖 2400 订单、1800 退货事件 | `clean.csv`（2400）、`monthly.csv`（4） |
| O04 | 月末库存与补录冲销 | 180 库存键、4800 条出入库/补录事件 | `stock.csv`（180）、`quarantine.csv`（65） |
| O05 | 客户通讯录合并与冲突待办 | 1200 条通讯录、400 客户 | `mapping.csv`（1200） |
| O06 | 客服记录对外分享前脱敏 | 1200 条多行工单、80 人字典 | `sanitized.csv`（1200） |
| O07 | 用政策与业务台账核验周会结论 | 24 份政策、4800 事实行、36 项主张 | `decisions.csv`（36） |
| O08 | 扫描小票与付款流水核验 | 36 小票/9 页、184 条付款流水 | `receipts.csv`（36） |

考点集中在：多版本取舍（按日期/修订号决胜）、重复与作废、窗口内外的资格判定、
枚举值逐字查表、字符串 ID 保留前导零、整数分金额与有理数汇率、多行记录与 BOM/CRLF 噪声。

## 追加套（`addendum-v1/`，5 题）

| ID | 标题 | 交付文件 |
|---|---|---|
| P01 | 生产故障证据归并 | `triage.csv` |
| P02 | 生产配置依赖与回滚评估 | `config_review.csv` |
| P03 | 客户资料导入与例外审核 | `accepted.csv`、`rejected.csv` |
| P04 | 跨日值班与部分请假冲突核验 | `schedule_review.csv` |
| P05 | 账单付款、退款与拒付对账 | `reconciliation.csv` |

追加套每题输入 2–4 个文件、10–43 KB，适合改完代码后的快速回归；
题面比基准套更短，但决胜规则（如 `CERTIFIED > APP > AUTO`，同级按 `revision` → `event_at` → `event_id`）同样写死。

## 目录结构

```
benchmarks/office/
├── README.md
├── tools/check.mjs            # 结构与完整性校验（也是 L1 结构分）
├── base-v1/
│   ├── 任务目录.json / .csv    # 题目清单：规模、输入文件数/字节数、输出行数、manifest sha256
│   ├── 开始说明.md
│   └── O01…O08/              # 任务说明.md + task_manifest.json + input_manifest.json + inputs/
└── addendum-v1/
    ├── 开始说明.md
    └── P01…P05/
```

## 跑一遍

```bash
node benchmarks/office/tools/check.mjs          # 详见每题输入数与交付文件
node benchmarks/office/tools/check.mjs --quiet  # 只报结果
```

校验内容：每题四件必备、`input_manifest.json` 逐文件 sha256 与字节数、
`prompt_sha256` / `input_manifest_sha256` 复算、基准套 `任务目录.json` 的 `manifest_sha256` 复算、
输入目录里有没有未登记的多余文件、**题面声明的交付表头必须等于 `task_manifest.outputs[].headers`**、
以及 `inputs` 的字节保持策略是否还在（见下）。

## 完整性契约（改题前请先读）

三层哈希把题目钉死：

```
任务目录.json ──manifest_sha256──▶ <题>/task_manifest.json
                                  ├──prompt_sha256───────▶ <题>/任务说明.md
                                  └──input_manifest_sha256──▶ <题>/input_manifest.json
                                                                    └──sha256──▶ inputs/ 每个文件
```

所以：
- **不要改 `inputs/` 的任何内容或文件名**（哪怕只改换行符）。
- 改题面（`任务说明.md`）后必须回写该题 `task_manifest.json` 的 `prompt_sha256`；基准套还要同步 `任务目录.json` 的 `manifest_sha256`。
- 校验器会在不一致时直接失败，并把差异指到具体文件。

## 编码口径：故意保留 BOM 与 CRLF

两个套件的 CSV 输入**全部是 UTF-8 带 BOM + CRLF**（模拟 Excel 导出），这是题目噪声的一部分：
表头比较要按字段名、能吃掉 `\ufeff`；按行切分不能假设只有 `\n`。题面里已声明这一点。

因此 `.gitattributes` 对这批数据做了例外：

```
benchmarks/office/**/inputs/** -text
```

否则 git 会按 `* text=auto eol=lf` 把 CRLF 规范化成 LF，**所有 `sha256` 立刻失效**。
改了这条规则，校验器会直接报错。

## 评分口径（规则公开，真值私有）

分三层，**公开与私有的边界很清楚**：

| 层 | 内容 | 在哪 | 判什么 |
|---|---|---|---|
| 结构 | `tools/check.mjs` | 公开（本仓库） | 文件齐、表头契约、哈希链完整、CRLF/BOM 策略 → 通过/不通过。**不判数值** |
| 规则 | `grading/` | 公开（本仓库） | 怎么算分：v5 六维加权 `Q`、v5.5 单元格精确匹配 + `exact`、计量口径 |
| 真值 + 评分器 | `reference/*.csv`、`truth.json`、`bench.py`、`score.py` | **独立私有仓库** | 逐单元格对错，出最终分 |

两个套件的评分函数**不同、不可混用**：v5（`O01`–`O08`）是六维加权质量分 + 严格有效交付布尔量；
v5.5（`P01`–`P05`）是单元格匹配率 + `exact` 标志，五题等权。**不能合成一个总排名。**
细则见 [grading/README.md](grading/README.md)。

### 真值为什么必须隔离

一份 `reference/*.csv` 就是一份满分交付 —— 谁拿到谁抄。所以：

- 私有材料在**独立私有仓库** `LarryE135/dsh-office-bench-private`（真值 8+5 题、三个评分器、指纹校验）；
- 公开仓库**永不包含**真值，由 `scripts/guard-bench-leak.mjs` 强制保证（哈希黑名单、命名黑名单、
  `inputs/` 之外禁止出现任何表格文件）。该检查已接入 `npm run verify` 与 `prepublishOnly`；
- 评测时 agent 工作区**只挂单题**，私有库挂在独立路径 `$OFFICE_BENCH_PRIVATE`，不对 agent 侧导出。

### 版本锚点

`grading/公开评分标准/文件校验.json` 的 `source_fingerprints` 记录私有库 6 个文件的 SHA-256：

- 公开侧 `check.mjs` 复算规则文档自身 4 个文件的哈希（防规则被悄悄改宽松）；
- 公开侧 `guard-bench-leak.mjs` 把这 6 条指纹当**黑名单**（私有文件混进公开仓库立即失败）；
- 私有侧 `verify-fingerprints.mjs` 反向校验，防止私有库换版本而公开规则还是旧的。

改评分器 ⇒ 必须同时重新发布公开规则包并更新 `文件校验.json`，否则两边立刻对不上。

## 与 npm 包的关系

`benchmarks/` **不在** `package.json` 的 `files` 白名单里 —— 基准数据只随 git 仓库分发，不进 npm 包。
需要随包分发时再单独讨论（数据件进 npm 会显著增大体积）。

## 来源与许可

作者自建的两个虚构套件（原始压缩包：`日常办公数据处理测试-v5-执行包.zip`、`日常办公任务包-v5.5.zip`）。
题目数据全部合成，不含真实个人信息。本仓库内以解包后的纯文本形态保存，便于 review 与 diff；原始 zip 不入库。