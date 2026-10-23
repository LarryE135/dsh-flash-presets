# dsh-plan-rounds

会话级「计划轮数」控制：默认关闭；`/plan-rounds 2` 启用两轮计划，`/plan-rounds 4` 增强到四轮。

## 它做什么

1. **命令** `/plan-rounds 0|2|4` —— 写入本会话状态（经 `command/run` 事件落进会话日志，可回放/可续）。
2. **投影** `planRounds` —— 客户端 `useProjection('planRounds')` 即可拿到 `{ rounds }`，供按钮/状态图标渲染。
3. **系统提示契约** —— 按当前轮数注入 `planning-rounds:contract` 段：要求先写 `PLAN-v1.md … PLAN-v${N}.md`（每轮严格评审上一轮，把每条需求配成可执行判据），再冻结 `ACCEPTANCE.md`，实现后逐条跑验收并引用观测结果。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `defaultRounds` | 0 | 未设命令时的轮数 |
| `sectionOrder` | 41 | 注入 system prompt 的顺序位 |

## 实测（M1，单次冒烟）

任务：单文件离线计算器。`defaultRounds: 2` 产出 `PLAN-v1.md`(55 行) → `PLAN-v2.md`(68 行，含「Rejected as not acceptance-grade」逐条否决) → `ACCEPTANCE.md`(65 行) → `verify-calculator.mjs`(503 行) → `calculator.html`。
