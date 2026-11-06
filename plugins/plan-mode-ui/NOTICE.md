# NOTICE — plan-mode component

`dsh-plan-mode-ui`（本包里的计划模式组件，plan-mode v1）以 DeepSeek Harness 的 plan-mode 行为为蓝本改写：
提示词结构、工具清单与「先写计划、等审批、再执行」的交互流程都来自上游。

- 上游项目：deepseek-ai/deepseek-harness（MIT License）
- 上游版权：Copyright (c) 2026 DeepSeek
- 本组件版权：Copyright (c) 2026 LarryE135
- 许可证全文：见仓库根目录的 `NOTICE` 与 `LICENSE`（MIT）

本组件对上游的改动：宿主半边（`lib/index.js`）与浏览器半边（`lib/client.js`）重写为可独立分发的插件；
计划状态持久化到 `$DSH_HOME/plan-mode-ui/state.json`（最多 50 条会话，LRU 淘汰）；与预设的联动只通过
`agent-presets` 列表读取，不修改任何会话文件。
