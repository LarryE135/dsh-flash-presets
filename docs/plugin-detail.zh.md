为 DeepSeek V4.1 Flash 调校的 DeepSeek Harness 预设：更早压缩上下文、裁切过长的工具输出、关掉低频工具、用 run_code 合并调用。它不改变模型能力上限，只让能力范围内的任务花更少的预算。

### 两个预设

| 预设 | id | 规则 | 何时用 |
| --- | --- | --- | --- |
| 精简·PTC v3（lean-v3） | `flash-lean-ptc-v3` | 13 条 | 默认，适合绝大多数日常工作 |
| 精简·PTC v3 balance | `flash-lean-ptc-v3-balance` | 3 条 | 约束更弱，适合需要模型发挥的场景 |

在新会话的预设选择里挑一个即可。两者共用同一套压缩 / 裁切参数（压缩阈值 25%，保留 20k）。

### 运行时组件（组件列表里的「Flash 精简预设」一行）

这一行下面挂着五个功能，各自按需要的宿主服务启动，缺哪个服务只影响对应功能：

- **run_code 优化**：glob / grep 只读并发，PTC 运行时常驻。关闭：`DSH_FLASH_PRESETS_CONCURRENCY=0`。
- **计划模式**：输入框左侧的计划按钮与面板，设置在「设置 → 计划模式」。桌面端没有 web 服务时不启动。
- **旧会话兼容**：早期版本用过的 5 个历史预设 id 映射到 `flash-lean-ptc-v3`，旧会话照常打开。纯内存，不改会话文件。
- **交付门**（默认关）：工作区里有 `verify.sh` / `verify.ps1` 时，回合收尾自动验收，不通过就把失败清单交回模型。
- **flash_sh**（默认关，仅 Windows x64）：Bash 兼容的 shell 工具，由可选依赖 `dsh-flash-sh` 提供，其他平台不安装。它不受沙箱约束：非「完全访问」会话里要你审批，同类命令一个会话只问一次，危险命令每次都问。

单独开关某个功能：在 profile 补丁里给 `id: flash-presets` 写 `config.planMode` / `toolConcurrency` / `alias` / `deliveryGate` / `flashSh` 的 `enabled`。0.3.2 及以前按旧组件 id（`flash-presets-core` / `plan-mode-ui` / `flash-presets-alias` / `delivery-gate`）写的覆盖升级后仍然生效。关掉整行会连旧会话兼容一起关掉。

开关示例、实测数据与版本兼容表见 [GitHub](https://github.com/LarryE135/dsh-flash-presets)。
