# DSH 0.2.2-rc.3 上下文注入实测（2026-11-14）

> 方法：把 DSH 的 LLM 出口指到一个本机 mock（`/tmp/mockllm.py`，Anthropic Messages 协议 + SSE），
> 逐条抓下发往模型的**完整请求体**，再按块统计字符数。字符数按 /3 粗算 token（DeepSeek 中文偏 1.6–2 字符/token，
> 英文代码偏 3–4，这里取 3 作横向比较口径）。
>
> 复现：`DSH_HOME=~/.dsh dsh --profile probe --patch /tmp/probe-mock.yml headless "turn one"`（profile `probe` 由 headless 模板建）。
> 抓包落在 `/tmp/mockllm/req-*.json`。

## 一、一次普通请求到底由什么构成

vanilla（probe profile，无本仓库预设，第一轮）：

| 块 | 字符 | 何时发 | 说明 |
|---|---:|---|---|
| system prompt | 2,949 | 每请求 | 15 段，绝大多数是工具插件的「用法纪律」 |
| tools（24 个 schema） | 20,727 | 每请求 | 占总量 73% |
| 用户消息里的 AGENTS.md | 2,350 | 每会话一次 | `~/.dsh/AGENTS.md` 原文 |
| 用户消息里的 runtime-context | 742 | 每会话一次（内容变了会重发并作废旧快照） | cwd / 沙箱策略 / 审批 / agent 身份 |
| 用户消息里的 skill 目录 | 1,420 | 每会话一次 | 3 个技能；随技能数线性增长 |
| **每请求合计（文本）** | **≈ 23.7 KB（≈7.9k tok）** | | 之后每轮把整段历史再发一遍 |
| body 附加字段 `dsh_session_log` | 34,430 | 每请求 | rc.3 新特性：整份会话日志上传（8MB 上限） |
| body 附加字段 `dsh_plugin_packages` | 6,359 | 每请求 | 插件清单上报 |

> 两个附加字段不进模型上下文（不花 token），但每请求多传 ≈40 KB。

## 二、工具面的真实价格（schema + 它自带的那段 system 纪律）

| 家族 | schema 字符 | 附带纪律（system 段） | 合计 | 占比 |
|---|---:|---:|---:|---:|
| workflow | 3,477 | 325 | **3,802** | 18% |
| subagent 全家（subagent / fork / list / send / wait / control） | ≈5,190 | 363 | **5,553** | 27% |
| goal 全家（create / update / get） | 1,811 | 528 | **2,339** | 11% |
| jobs 全家（output / kill / list） | 1,210 | 382 | **1,592** | 8% |
| bash | 2,330 | — | 2,330 | 11% |
| edit + write + read | 2,550 | 372 | 2,922 | 14% |
| web（search + fetch） | 601 | 365 | 966 | 5% |
| skill（目录 + 工具） | 348 | — | 348 + 目录 | — |

单个最大项：`workflow` 3,477（描述 1,667）、`bash` 2,330、`subagent_fork` 1,753、`subagent` 1,646、`edit` 1,197、`update_goal` 1,033。

## 三、实验：把「大概率用不上」的家族关掉会怎样

overlay：关 `tool-workflow`、`tool-subagent`、`tool-subagent-fork`、`tool-subagent-control`、
`session-log-deepseek`、`plugin-package-inventory-deepseek`，并把 `tool-skill.catalogDescriptionMaxLength` 压到 40。

| 指标 | vanilla | lean | 差 |
|---|---:|---:|---:|
| tools | 24 个 / 20,727 | 18 个 / 12,059 | **−8,668（−2.9k tok）** |
| system prompt | 2,949 | 2,031 | −918（工具纪律跟着工具消失） |
| skill 目录 | 1,420 | 849 | −571（`catalogDescriptionMaxLength: 40`） |
| runtime-context | 742 | 539 | −203（subagent 那两句随之消失） |
| 请求 body | ≈60 KB | ≈18 KB | −70% |

**结论：每请求可省 ≈3.5–3.7k tok（约 −38%），且全部来自"这个会话根本用不上"的工具，不动任何规则文本。**

## 四、发现（按"是否需要改代码"分类）

### A. 纯配置即可，零风险

1. `tool-skill.catalogDescriptionMaxLength`：默认取技能描述前 N 字符，压到 40 就省 571 字符；技能越多省得越多（本机现在 3 个，装了 office 那套 7 个会更大）。
2. `session-log-deepseek.enabled: false`、`plugin-package-inventory-deepseek` 关掉：每请求少传 ≈40 KB（不省 token，省带宽/首字延迟）。
3. 关掉整族工具（workflow / subagent / goal / jobs）：省 1.5–5.5 KB schema + 对应 system 纪律。

### B. 需要改代码/加插件

4. **工具描述瘦身**：`workflow`(1,667 字描述)、`subagent`(668)、`update_goal`(24 但 schema 1,033) 有明显冗余；
   本仓库已有"运行期打补丁"的先例（`flash-presets-core` 给 glob/grep 加只读并发标记），可以同样方式给 schema 做无损裁剪，
   但**必须 A/B 验证不掉能力**。
5. **按需加载工具**：DSH 目前是"注册即全量下发"。理想形态是"先给 8–10 个核心工具，其余由模型显式 `tool_search` 拉取"，
   这要新写一个插件（把工具注册代理化），收益最大（可到 −10k tok/请求）但工程量也最大。

### C. 不需要动（已验证不是问题）

6. **不是每轮都重新注入**：system-reminder 快照一次会话只发一次，内容不变不重发；之后每轮只是把历史重发一遍（正常）。
7. **goal 注入**：只在 goal 状态变化/回合推进时以 user 消息形式追加一段 wrap-up 上下文，不是常态开销。

## 五、建议的下一步（待定）

| 项 | 预期收益 | 风险 | 验证方式 |
|---|---|---|---|
| 预设里加 `catalogDescriptionMaxLength: 40` | −0.2k tok/请求 | 极低（只是描述截断） | 直接生效，无需 benchmark |
| 预设新增"精简工具面"档（关 workflow + subagent 族） | −3.0k tok/请求 | 中：丢多智能体能力 | DSH-Bench A/B，看成功率与成本 |
| 关 session-log / plugin-inventory 上报 | 带宽 −40 KB/请求 | 低（本地特性） | 抓包对比 |
| 工具 schema 无损瘦身 | −1.5k tok | 中高 | A/B + 人工检查描述完整性 |
| 按需工具加载插件 | −5~10k tok | 高（要新插件） | 先做 spike |

## 六、按需工具加载（步骤 5）的可行性 —— rc.3 已经内建一半

**已核实的原语**（都在 rc.3 里，不需要改 DSH）：

| 事实 | 位置 |
|---|---|
| 工具定义可带 deferLoading: true，schema 会带上它 | @deepseek-ai/dsh-tools：ctx.tools.register(def, { deferLoading: true }) → projectToolSchema 保留该字段 |
| 带 deferLoading 的工具**不进请求** | dsh-llm-pi-ai：options.tools.filter(t => !t.deferLoading) |
| Anthropic 路径改发 defer_loading: true（schema 不占上下文，模型按需拉取） | dsh-llm-deepseek：...tool.deferLoading === true ? { defer_loading: true } : {} |
| 会话历史维护「声明集 + tool-addition / tool-removal 块」并据此重建请求 | dsh-llm：projectToolUpdates / toolDeclarations / rebaseAdditionOnlyHistory |
| 全部工具都 defer 时走 in-history 路由（工具声明放进历史消息） | dsh-llm-pi-ai:2097（updates.toolUpdate === "in-history"） |

**缺的那一块**：面向模型的 tool_search 工具不存在；tool-addition 块目前只由 dsh-agent-loop 在**插件注册工具的那一刻**产生。
所以要做的是「先 defer、后激活」，而激活必须在会话中途重新注册 / 或调用 registry 的激活接口 ——
**这是唯一没验证的点**（同名二次注册是否被允许、是否等价于激活，要在 mock 抓包里试）。

**骨架**（spike 目标，约 150 行）：

1. 宿主半边启动时把「可选工具」按 config 名单整体标 deferLoading: true（需要 registry 的 list/get + 重新注册或激活接口）；
2. 注册一个常驻 tool_search(query)：按名单检索 → 激活命中的工具 → 返回「已激活 X、Y」；
3. 验证：mock 抓包看到**首个请求的 tools 从 24 降到约 12**，模型调 tool_search 后的下一个请求里目标工具出现。

**风险**：同名二次注册若被 registry 拒绝，就得改用 dsh-agent-loop 的 tool-addition 通道（可能要 patch 它的一个入口），
工程量从「一个插件」升到「一个插件 + 一个小 patch」。先做 spike 判定。

## 七、A/B 实测：工具面瘦身到底值多少（DSH 0.2.2-rc.3，deepseek-v4.1-flash，104 题）

走 WB Proxy；两对臂，只差工具面，其余（规则/压缩/裁剪/判分）完全一致。

| 臂 | 工具面 | 遍数 | 正确率 | 缓存命中 tok | 未命中 tok | 输出 tok | 费用 ¥ | 每答对一题 ¥ |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| std | 原生 24 工具 | 3 | 86.2% | 47.17M | 2.31M | 2.31M | 24.96 | 0.0928 |
| std-lean | 原生 12 工具 | 3 | 84.3% | 31.31M | 1.91M | 2.00M | 21.03 | 0.0800 |
| v3 | PTC（run_code） | 1 | 87.5% | 9.53M | 0.47M | 0.57M | 5.89 | 0.0647 |
| v3-lean | PTC + 关工具族 | 1 | 84.6% | 8.47M | 0.49M | 0.55M | 5.68 | 0.0646 |

配对检验（题 × 遍，312 对）：

| 对照 | Δ | 丢/得 | McNemar p | 稳定丢（≥2 遍） | 费用 Δ | 每答对一题 Δ |
|---|---:|---|---:|---|---:|---:|
| std → std-lean | −1.9pp | 11 / 5 | 0.210 | 无 | **−15.7%** | **−13.8%** |
| v3 → v3-lean | −2.9pp | 5 / 2 | 0.453 | 无 | −3.6% | −0.2% |

**结论**

1. **原生工具面砍 schema 是赚的**：命中 token −33.6%、请求 −10.7%、费用 −15.7%、每答对一题 −13.8%，正确率在噪声内（p=0.21），且没有任何一题在 ≥2 遍里稳定丢。
2. **PTC 预设不要动**：只省 3.6%，白丢能力。（PTC 本来只有 run_code 一个工具，砍不出东西。）
3. 落地形态应当是**原生面的可选档/独立预设**，不是改现有预设默认值。

复现条件：bench 副本在 /home/larry/w/pkg，臂定义见其 config.json 的 std / std-lean 与 overlays/lean-tools.patch.yml。
