# Team Agent（0.2.2-rc.3）成本与可调项

## 结论速览

- Team 是**会话级开关**，默认关闭；开启后每个模型步多出 **4 个工具 schema** 和 **1 段共享任务政策**。
- 政策文本 `TEAM_POLICY`：**947 字符**（≈ 300 tok）；4 个工具的描述合计 **336 字符**（62/92/82/100）。
- **实测（2026-11-16，静态提取插件声明的 schema）**：4 个工具按 API 形态序列化后共 **2,729 字符**
  （team_task_create 613 / team_task_list 772 / team_task_get 252 / team_task_update 1,092），
  加政策 947 字符 = **每请求常驻 3,676 字符 ≈ 1,225 tok**。
  此前按描述文本估的 400–600 tok 偏低，以此处为准。
- 对照：原生工具面 20.7 KB（≈6.9k tok）比它大一个量级，Team 只占约 18%；
  因此 Team 不是省 token 的主战场，它的价值在**协作能力本身**。
- `dsh-agent-team` 的配置接口只有两个字段：`defaultEnabled`（默认 false）、`maxTasks`。
  `maxMembers` / `maxMessageBytes` 属于 subagent 控制包，不在 team 域里。

## 三个包的分工

| 包 | 角色 | 模型可见 |
|---|---|---|
| `dsh-agent-team` | 服务层：`team/mode` 事件 + 任务板 DAG（CAS + revision） | 否 |
| `dsh-tool-agent-team` | 4 个任务板工具 + 政策文本 | 是（仅当根会话开启 Team） |
| `dsh-client-ui-agent-team` | Web 共享任务板 | 否（纯 UI） |

## 关键约束（上游文档明示）

- 工具按**根会话**的模式选择：后代 agent 继承，不能单独开关。
- 任务 owner **不会**因成员失活、interrupt、进程退出而自动释放。
- 任务变更不会唤醒 `wait_agent`、不会发 inbox、不会启动空闲 agent；要对方行动必须 `send_message`。
- `dsh-tool-agent-team` 不接受配置（不能裁剪政策文本或单个工具）。

## 我们的用法：`lean-v3-team` 预设

新增 `presets/flash-lean-ptc-v3-team.patch.yml`（**非默认**，order 28）：

```yaml
- id: agent-team
  name: '@deepseek-ai/dsh-agent-team'
  config:
    defaultEnabled: true   # 新根会话默认开启 Team
    maxTasks: 40           # 单 Team 保留的任务上限
- id: tool-agent-team
  name: '@deepseek-ai/dsh-tool-agent-team'
```

其余行与 `flash-lean-ptc-v3` 完全一致（13 条规则、压缩阈值 0.25、保留预算 20000、PTC 展示层）。

### 为什么默认不开在 lean-v3 上

Team 政策 + 4 个工具是**每步常驻**开销；对单人任务只是纯成本。做成并列预设，谁需要谁选。

## 待验证（下一步实验）

1. bench 三臂：`no-team` / `team` / `team-lean`，各 2 遍 ×104 题，看正确率与费用变化。
2. ~~实测每请求增量~~ **已完成（2026-11-16）**：静态提取工具 schema 2,729 字符 + 政策 947 字符 = 3,676 字符/请求。
3. 观察 `maxTasks: 40` 是否够用（默认值未在 catalog 中给出区间）。