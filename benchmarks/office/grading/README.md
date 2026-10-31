# 评分口径（公开规则 / 私有评分器）

这个目录只放**可公开的评分规则**；真值与评分器代码在**独立私有仓库**，公开仓库永不包含。

| 位置 | 内容 | 可见性 |
|---|---|---|
| `公开评分标准/` | v5 六维质量分、v5.5 单元格精确匹配、计量口径（原包原样，字节未改） | 公开 |
| 私有仓库 `dsh-office-bench-private` | `reference/` 真值 CSV、`bench.py` / `score.py` / `grade_batch.py` | **私有** |
| `benchmarks/office/tools/check.mjs` | 结构 + 完整性 + 表头一致性（**不判数值**） | 公开 |

`公开评分标准/文件校验.json` 里的 `source_fingerprints` 是本包对私有库的**版本锚点**：
6 条 SHA-256 指向 `bench.py`、`score.py`、`grade_batch.py` 等。`check.mjs` 会复算它自证的 4 个文件哈希；
而 `scripts/guard-bench-leak.mjs` 反过来把这 6 条指纹当**黑名单**——任何文件命中即视为私有资产泄漏，构建失败。

## 两个评分函数，不能混用

- **v5（`O01`–`O08`）**：六维加权质量分 `Q = 10×结构 + 35×正确性 + 20×完整性 + 15×约束 + 10×来源 + 10×记录诚信`，
  要求表之间等权，8 题等权；另有一个**严格有效交付**布尔量（高 Q 不等于严格通过）。
- **v5.5（`P01`–`P05`）**：不适用六维。任务分 = 匹配单元格数 / 期望单元格数 × 100，字符串严格相等；
  五题等权；另有 **exact** 标志（除单元格全对外，还要求表头顺序、无重复主键、无额外交付文件）。

两版任务集不同、评分函数不同，**必须分别报告**：不能把 v5.5 套 v5 的权重，也不能把两版质量分合成一个总排名。

## 与 `task_manifest.json` 的关系

公开仓库里的 `task_manifest.json`（`outputs[].headers/key/types`）是**结构契约**，说明"要交什么表、哪些列、主键是什么"；
它**不含任何真值**，所以公开不构成泄题。真值是每题每个单元格的期望值，只存在于私有仓库。

## 评分器契约（想自己接评分器时按这个来）

私有库对每题需要提供：

```
<set>/gold/<TASK_ID>/reference/<交付文件名>.csv   # 与 task_manifest.outputs 同名的真值表，UTF-8
```

评分器入口约定（建议实现为可执行命令，由 harness 调用）：

```bash
# 输入：一个运行目录（内含 deliverables/），输出：JSON 到 stdout
OFFICE_BENCH_PRIVATE=/path/to/private  grade-run --task O04 --run /path/to/run
# → {"task":"O04","score":96.4,"exact":true,"cells":{"matched":482,"total":500},"problems":[]}
```

v5 题需要额外输出六维分项（`structure/correctness/completeness/constraints/source/integrity`），
v5.5 题需要额外输出 `cells.matched` / `cells.total` 与 `exact`。

## 隔离协议（评测时怎么摆）

**防作弊的边界不是"文件放在哪个目录"，而是"agent 的进程能不能读到"**。约定如下：

1. **agent 工作区只挂单题**：`inputs/` + `任务说明.md` + `task_manifest.json` + `input_manifest.json`。
   不要把整个 `benchmarks/office/` 挂进去——`base-v1/` 里其余题目、`任务目录.json` 都不是本题必需。
2. **私有库挂在评测容器独立路径**（`$OFFICE_BENCH_PRIVATE`），**不向 agent 侧导出该变量**，也不放进它的 cwd 或其父目录。
3. **`grading/` 本身也不进 agent 工作区**：规则里没有真值，但"额外交付文件会让 exact 失败""表头顺序必须一致"这类细则会引导应试行为。
4. **deliverables 由 harness 拷到评分沙箱**再打分，agent 全程不接触真值目录与评分脚本。
5. **不用 git submodule 指向私有库**：会让 `git clone` 公开仓库直接失败，还暴露私有库名。

## 为什么规则可以公开

这份规则文档公开的是**怎么算分**，不是**答案是什么**。公开它的收益是结果可复核（别人能验证你的分数不是编的），
风险面仅限"应试者知道评分细则"——用上面的隔离协议（第 3 条）挡住即可。
真值泄漏的风险面完全不同：一份 `reference/*.csv` 就能直接抄出满分交付，所以它必须物理隔离。