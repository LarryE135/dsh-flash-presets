# lean-v3（flash-lean-ptc-v3）技术文档：套件、实现方式与工作闭环

> 名词先澄清：仓库里有两个东西，常被混称"插件"——
> - **lean-v3 = 预设（preset）**：`presets/flash-lean-ptc-v3.patch.yml`，本质是一份 **patch 片段**，往 DSH 配置里插入一个 preset 条目，条目内再声明 ~20 个插件的启用方式与参数。
> - **dsh-plan-mode-ui = 插件**：`plugins/plan-mode-ui/`，独立 npm 包，负责计划模式的档位胶囊、提示段注入与进度监测。
>
> 本文写的是 **lean-v3 预设**；涉及插件联动的地方会明确标注。

---

## 1. 全貌：一次请求里发生了什么

```
profile patch (cordis.patch.yml)
  └─ 应用 presets/flash-lean-ptc-v3.patch.yml  →  插入 preset: flash-lean-ptc-v3 (order 27)
       └─ preset.plugins[]  →  决定本次会话挂了哪些插件、各自参数
            ├─ persona            → 往系统提示注入 14 条 FLASH OPERATING RULES
            ├─ tool-* / skill-*   → 决定模型能看见哪些工具、输出上限
            ├─ planning(group)    → plan-mode 插件的政策段（可在预设里被 isolate）
            ├─ compaction(group)  → 压缩 + 工具结果裁剪
            └─ delegation(group)  → 子代理三件套
  ↓
系统提示 = [只读前缀段] + [工具清单] + [persona 规则] + [plan 政策] + …   ← 一旦变动，KV 前缀缓存整体失效
  ↓
agent loop：turn → step → tool call → tool result → 下一步
  ↓
上下文治理：tool-result-pruner（单条超 8192 字符裁中段）→ compaction-basic（0.25 阈值压缩历史）
  ↓
交付：present / 文件写入 / 最终答复
```

**一句话**：lean-v3 不是一个"功能"，而是**一条把"轮数、工具输出、历史、并行"四个成本源同时收口的装配线**。

---

## 2. 套件清单（按职责分六组）

| 组 | 插件 id | 作用 | 关键配置 / 实现要点 |
| --- | --- | --- | --- |
| A 人设与指令 | `persona` | 注入 14 条硬规则 | `suffix` 多行文本，分 5 段：预算 / 安全 / 阻塞 / 路由 |
| | `agent-instructions` | 读取仓库级 AGENTS.md | 与 persona 叠加，优先级：persona > 仓库指令 |
| B 工具面 | `tool-bash` / `tool-pwsh` | 平台互斥 | `disabled: !!js process.platform === 'win32'` 及反向 |
| | `tool-fs` | read/write/edit | 单次结果受下游 pruner 约束 |
| | `tool-fs-search` | glob/grep | `sampleOverCapGlobResults: false`：超上限时**不抽样**，直接报告"结果过多"，避免模型拿到失真样本 |
| | `tool-jobs` | 后台作业 | 长任务不占轮次 |
| | `skill-filesystem` / `tool-skill` | 技能发现与加载 | 按需加载，不预塞上下文 |
| C 目标与规划 | `command-goal` / `tool-goal` | 目标生命周期 | 与 todo 区分：goal 是"跨轮目标"，todo 是"步内清单" |
| | `planning`(group, `isolate.planMode`) | 计划模式 | 内含 `plan-mode` 插件与它的政策段文本；isolate 让预设可以替换/关闭原生计划模式 |
| D 上下文治理 | `compaction`(group, isolate `compaction`+`toolResultPruner`) | 历史压缩 + 结果裁剪 | `compaction-basic`: `thresholdRatio 0.25`、`retainTokens 20000`、`compactionRetries 1`、`auto true` |
| | `tool-result-pruner` | 单条工具结果裁中段 | `thresholdChars 8192` / `headChars 4096` / `tailChars 1024`，中段以 marker 取代 |
| | `command-compact` | 手动触发压缩 | 逃生口 |
| E 委派 | `delegation`(group, isolate `workflowEngine`) | 子代理 | `tool-subagent`(provider spawn) + `tool-subagent-control`（0.2.2-rc.1 起 root 一并提供 `list_agents`，旧的 `./list-agents` 子路径行已删除）；子代理有独立上下文，主上下文只留摘要 |
| F 交互与交付 | `tool-ask-user` | 提问 | 与 plan 评审共用 user-questions 瀑布 |
| | `tool-todo` | todo_write + `todos` 会话投影 | 原生 TodoDock 渲染；插件按它算"滞后" |
| | `tool-web` / `tool-presentation` / `present` | 检索与外发 | present 只做"交付卡片"，不复制文件内容 |
| | `tool-plugin-manager` | 运行时装卸插件 | 与 profile 安装器配合 |

**关联项（谁依赖谁）**：
- `tool-todo` → 写 `todos` 投影 → `dsh-plan-mode-ui` 的进度/健康度 → 面板与提醒（**唯一跨包依赖**）。
- `compaction` 组内 `tool-result-pruner` 在 `compaction-basic` **之前**生效：先把单条裁小，再判断整段是否需要压缩 —— 顺序反了会白压一次。
- `planning` 组的 `isolate.planMode` 决定原生计划模式是否可见；lean-v3 里它被隔离，因此计划政策段由预设自己提供（这也是 plan-mode-ui 需要用"投影/服务/簿记"三路判定 native 的原因）。

---

## 3. 规则 → 机制映射（14 条 persona 规则各自靠什么兜底）

| 规则（摘要） | 依赖的机制 | 失效时的表现 |
| --- | --- | --- |
| 1 轮数预算 ≤20 回合 | agent loop 的 turn 计数 + 规则本身 | 拖成 60+ 回合，成本线性翻倍 |
| 2 先探测再动手 | 一次廉价 bash/read | 过度枚举设计，token 花在思考上 |
| 3 最小可用产物优先 | 交付类任务的门控 | 反复重写大文件 |
| 4 交付前一次性验收 | 合并验收命令 | 逐条验证 → 回合数爆炸（实测 80.8→33.6 步的主因之一） |
| 5 用 read/glob/grep 而不是 cat | 工具面 + 规则 | shell 浏览文件 → 输出被截断 → 再取一次 |
| 6 输出预算（管道/重定向/批处理） | bash 工具 8 KB 硬上限 | 大输出被裁，模型看不到中段 |
| 7-9 programmatic tool mode | `run_code` 折叠多次调用 | 单调用单回合，轮次成本高 |
| 10-11 语言与范围 | 无机制，纯纪律 | — |
| 12 两次失败换路子 | 无机制，纯纪律 | 死循环重试 |
| 13 路由感知 | 无机制（模型侧判断） | 高延迟路由下切太碎 |
| 14 卡住要报事实 | 无机制 | 沉默重试 |

---

## 4. 工作闭环（一个任务的七个阶段）

1. **注入**：preset 决定工具面与规则；系统提示前缀固定 → 缓存可复用。
2. **规划**：plan 政策（或 plan-mode-ui 的档位文案）要求先出计划与验收清单（P0-EXEC / CONVENTIONS 等）。
3. **探测**：用一次廉价命令确认事实（版本、文件、字段）——**不要**用 cat 全量浏览。
4. **执行**：run_code 折叠多调用；写文件、跑测试。
5. **验收**：一次性跑完所有验收项，记录 measured 数字。
6. **治理**：单条结果 >8 KB 被 pruner 裁中段；历史 >25% 窗口被 compaction 压缩并保留 20 k 近期。
7. **交付**：present 卡片 + 最终答复；todo/面板同步关闭。

**闭环的判据**：每一阶段都有"可观测产物"（计划文件、命令输出、measured 值、todo 状态、面板 indicator）。任何一环缺产物，下一环就只能靠猜 —— 这也是我们把 `debug.section` 探针、`debug` 计数暴露出来的原因。

---

## 5. 成本模型：为什么"砍工具结果"是个赌注

单步成本近似：

```
cost(step) ≈ prefix_tokens × P_cache + new_tokens × P_in + out_tokens × P_out
```

- **prefix** = 此前全部上下文（系统提示 + 历史 + 已进入上下文的工具结果）。缓存只对**最长公共前缀**生效，且工具结果一旦追加，就会进入之后**每一步**的 prefix。
- 因此一条被保留的工具结果，其代价不是"一次"，而是 `保留到会话结束的每一步`：多留 2 k tokens，后续 40 步就按 40 × 2 k × P_cache 计。
- 反过来，**砍掉**它若导致模型需要重新取（再调一次工具），代价 ≈ 新增 1 个 step（1 次完整 prefix 重读）+ 新结果 tokens。

**判定式**：设单次全量结果 = T tokens，重取 k 次，剩余步数 N，则

```
截断更省  ⟺  k × (T_retry + prefix) × P_cache  <  (T − T_trunc) × N × P_cache
```

即：**只有当"需要重取的次数 × 单次重取成本"小于"截掉的部分 × 后续步数"时，截断才赚**。截断在赌"模型不需要全量"；赌错就双倍付费（先付被砍的那份，再付重取的那份 + 一个 step）。

### 我们的实测数字（帮我把它说清楚）

| 场景 | 结果 |
| --- | --- |
| bash 工具单次输出 | 硬上限约 **8 KB**，超出写 spill 文件并给路径 |
| `tool-result-pruner`（8192/4096/1024） | 在上述所有 CPE 测试里**一次都没触发**——上游 bash 已经先裁了 |
| CPE 大日志（30 000 行 / 2.5 MB）自由访问 | 4/4 正确，**0 次截断**，69 k / 66 k tokens |
| 强制 `cat` 全量 | 两档都只剩 ~8.3 KB，均靠 spill 路径答对 |
| 中间探针、不给切片手段 | **100% UNSEEN**（两档都失真）；关掉 pruner 也没救 |
| 流式 500 行/s（16 200 行 / 1.52 MB） | 4/4 全对，计数精确（E2007 4 548 / E4010 4 559） |
| 流式 2 000 行/s（63 000 行 / 5.84 MB） | 4/4 全对，计时窗口精确 |
| 端到端预设对照（n=3，12 题） | lean-v3 1.437 M tokens / 33.6 步，基线 5.380 M / 80.8 步 |

**结论**：真正决定成败的不是"砍不砍"，而是**被砍之后模型还有没有定点访问的手段**（grep / sed 区间 / offset 读取 / spill 路径）。有 → 截断只花一次；没有 → 截断逼出"再调一次"，且每次都在给缓存续费。

---

## 6. 验证方法（这套东西是怎么被证明有效的）

1. **金丝雀**：跑批前断言两臂的规则条数不同、且合成配置里能看到 → 防"两臂配置相同却以为在对比"（踩过两次）。
2. **A/B harness**：`scripts/ab-run.sh`，逐题交错执行，减少时间漂移；`--json` 事件流算 tokens/turns。
3. **六维打分**：`Q` 加权 + `valid` 判定，私有 truth 仓库。
4. **单变量原则**：一次只改一个机制（preset 差异由 overlay 显式声明）。
5. **探针优先**：插件提供 `/api/plan-mode/state?probe=1`，直接看"这次注入了哪一版文案"，不靠猜。

---

## 7. 已知边界（诚实清单）

- **截断是无记忆的**：pruner 不知道模型接下来要什么；中段被裁后只能靠重新取。
- **缓存判定按前缀**：任何一处早期段落的措辞变化，都会让其后全部缓存失效（所以 persona 文本改动要整批重跑）。
- **单回合无审批通道时全量档会空转**：无头实验里 full 档 3/3 只写产物不写代码（0/7），因为它的前提是"先批准后实现"。
- **面板不是真相源**：面板/接口只是投影；0.6.6 起 `native` 判定统一为"投影 → 服务 → 簿记"，此前三条路径各看一半曾导致提示词与面板分叉。

---

## 8. 讲给别人听的三句话

1. **lean-v3 是装配线，不是单点优化**：轮数、工具输出、历史、并行四个成本源一起收口，才有 5.38 M → 1.44 M 的结果。
2. **每条规则都要有机制兜底**：没有机制兜底的规则（12/13/14 条）只能靠模型自觉，写文档时不要宣称它们是"保证"。
3. **截断的正确搭档是定点访问**：grep / 区间读取 / spill 路径；缺了这半边，砍输出就是把成本从"一次"搬到"每次"。
