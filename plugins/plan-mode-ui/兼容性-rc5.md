# 兼容性检查 · DSH 0.2.1-rc.5（2026-10-30）

对象：dsh-plan-mode-ui 0.4.3（本插件）、dsh-flash-presets 0.2.6（预设包）。
环境：DSH 0.2.1-rc.2 → **0.2.1-rc.5**（安装 2026-10-30 10:27，宿主 10:29:53 重启）。

## 结论

**兼容，不需要改代码。** 宿主半、客户端半、两阶段注入、预设包四条链路全部实测通过；发现的唯一差异是**行为变化**（headless 现在单回合内跑完规划+执行），不影响插件正确性，但影响实验脚本。

## 一、实测证据

| 项 | 方法 | 结果 |
|---|---|---|
| 单元/集成测试 | ./test/run.sh（64 项） | **64/64 通过** |
| 宿主半加载 | 线上 3081 的 /api/plan-mode/state | **HTTP 200**，返回完整状态（tier/scope/max/session/phases） |
| 两阶段注入 | headless 探针（tier=full） | PHASE 1 注入 → 写出 .plan-mode/{plan.md,EVIDENCE.md,P0-EXEC.yml,P1-TARGETS.yml}；PHASE 2 注入 → 执行并产出 OUT.md；**injects=1** |
| 客户端半 | puppeteer 带 token 打开 GUI | .pmo-root=1 / .pmo-btn=1 / style=1 / composer=1；控制台有 [plan-mode-ui] build v45；**pageerror 0** |
| 面板交互 | 点击 .pmo-btn | .pmo-panel 出现，含 关闭/轻量/全量 + 每次/自动/仅首轮 + 仅本会话；**错误 0** |
| 服务契约 | rc.5 源码 | webServer 服务名不变、register(route) 不变、systemPrompt.section() 不变；slot conversation.input.left / shell.overlay / settings.section 均在 |
| 预设包 | 27 个引用包逐个核对 | **全部存在**，无重命名/移除 |
| !!js 标签 | cordis-plugin-loader / app-boot | 仍受支持 |
| 预设仓库自测 | scripts/selftest.sh | **30/30** |
| 预设体检 | doctor.mjs --profile web --dump | 三项预设均出现在 dump-config；结论「干净」 |
| 校验链 | verify-yaml / verify-presets / compose --check | 全绿 |

## 二、行为变化（要改的是实验脚本，不是插件）

rc.2 上 headless 跑 tier=full 时 `injects=0`（回合结束，PHASE 2 注入不触发），因此 exp/ab-earlystop/runner.sh 用「两段式」模拟：第一段规划、第二段用 --session-id 续跑并手工粘 PHASE 2 文本。

rc.5 上同一个探针：**turns=1、injects=1、planAtTool=10、plan 与执行都在同一回合完成**。也就是说真实 PHASE 2 路径（宿主注入 steer）现在能在 headless 里跑通。

影响：
1. runner.sh 的两段式在 rc.5 上会「第一段就把活干完」，第二段变成重复执行 —— **必须改成单段**，或显式标记该臂为 emulation 并停止使用。
2. 之前 v1–v4 的全部 full 臂数据都是 emulation 产物；若要与 rc.5 的单段结果对比，需标注口径，或重跑一小组做校准。

## 三、建议动作

| 优先级 | 动作 |
|---|---|
| P0 | 把 exp/ab-earlystop/runner.sh 的 full 臂改为单段（tier=full 一次跑完），并重跑 3 次与旧数据对齐 |
| P1 | 插件版本 bump 到 0.4.4，CHANGELOG 写明「已在 DSH 0.2.1-rc.5 验证」；顺手把 npm 发布补上（0.4.3 仍未发） |
| P1 | 加一条兼容烟测：headless 单段断言 injects≥1 且 .plan-mode/plan.md 存在；GUI 侧断言 .pmo-btn 存在且点击后 .pmo-panel 出现（已有 puppeteer 能力，脚本可复现） |
| P2 | README 的兼容性一节补 rc.5；预设包 README 同步（预设侧无代码改动） |

## 四、未覆盖

- 浏览器侧只验证了「打开面板」，没有逐项点选 tier 并确认落盘（需要真实交互序列）；
- Windows 侧（PowerShell 宿主）未测；
- rc.5 与 rc.2 的完整 changelog 未获取（仓库无 CHANGELOG），本结论来自行为与契约实测，不是差异清单比对。
