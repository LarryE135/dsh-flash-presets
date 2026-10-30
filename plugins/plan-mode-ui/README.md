# dsh-plan-mode-ui

给 DeepSeek Harness（Web GUI）用的**两阶段计划模式**：一个 composer 图标 + 向上展开的面板，把「先计划、再执行」做进同一个回合里——不需要你手动发第二条消息。

```
你发一条消息 ──▶ 宿主拦下回合 ──▶ PHASE 1 只读取证 + 写计划产物
                                        │
                    计划写完、回合即将结束 ◀┘
                                        │
                    ★ 自动投递 PHASE 2，同一回合继续执行
                                        │
                          跑验收项、回报实测值、收尾
```

## 安装（桌面端）

需要一个已经能跑的 DSH web profile。两种方式选一种：

```bash
# A. 从打好的 tarball 装（推荐，跨机器拷贝方便）
dsh plugin --profile web add ./dsh-plan-mode-ui-0.1.1.tgz

# B. 直接从目录装（开发时才用，走 link）
dsh plugin --profile web add /absolute/path/to/dsh-plan-mode-ui
```

装完**重启 dsh web**，然后硬刷新页面（Ctrl/Cmd+Shift+R）。

> 包自带 `cordis.patch.yml`（`dsh.bundle`），安装时会把
> `{ id: plan-mode-ui, name: dsh-plan-mode-ui }` 这一行插进 profile 的插件层，
> 不需要手工编辑 profile 的 `cordis.patch.yml`。

## 怎么确认真的生效（30 秒）

1. **图标**：输入框左下角工具栏里多出一个「阶段」图标。点开是面板：第一行 `计划模式 · 本对话`，第二行是当前档位（关闭/轻量/全量），随后是滑杆与 Max/生效范围。面板**没有**独立的「退出计划」按钮：把档位拖到「关闭」就是退出（服务端切档时会立刻发 `/plan off`，并判定为"取消计划"而不是"批准计划"）。

   > **图标不动怎么查？** 图标有五个状态，其中 `armed`（原生开着、没有回合在跑）、`planned`（计划已批准、回合已收尾）、`idle` 本来就是静止的——和"动画坏了"肉眼无法区分。浏览器控制台里用自检接口：
   >
   > ```js
   > __pmo.hud(true)   // 右下角浮层：phase / indicator / native / 档位来源 / 图标的 data-phase 与颜色 / 正在跑的动画 / 是否被 reduce-motion 压制 / 轮询间隔
   > __pmo.why()       // 一句话解释"这枚图标为什么是这个样子"
   > __pmo.anim()      // 每个图标当前在跑哪些动画（名字 + playState）
   > __pmo.state()     // 客户端此刻认为的状态快照
   > ```
   >
   > `why()` 会把"设计上静止"（armed/planned/idle）、"系统开了减弱动态效果"（`prefers-reduced-motion: reduce`）、"CSS 没加载完整"三种情况分别说清楚。
   >
   > 退出统一走「关闭」档：拖到关闭 = 立即退出原生计划模式（全量档下同时判定为**取消**，不会投递执行阶段）。所以面板里不再有第二个"退出"入口。
   >
   > 档位与原生是两层：**档位=关闭**表示本插件不介入，并且会**立即**替你退出原生计划模式（不用等下一个回合）；「退出原生计划模式」是单独退出 DSH 那层（等价 `/plan off`），保留档位设置。
2. **端点**：

   ```bash
   curl -s http://127.0.0.1:3081/api/plan-mode/state | head -c 300
   # {"ok":true,"tier":"light","scope":"auto","max":false,
   #  "settings":{"source":"default","overrides":0,"default":{...}},
   #  "phase":"idle","planning":false,"phases":[],"debug":{...}}
   ```

3. **提示词**：0.5.0 起 **light 只做桥接**，系统提示里只有 DSH 自带的 `plan:policy` 段，
   不再出现本插件的 `ACCEPTANCE …` / `PHASE 1`。full 档在计划批准后才会出现
   `ACCEPTANCE (plan-mode tier=full, … phase=executing)` 与 `PHASE 2 — EXECUTE …`。
4. **计划评审卡**：light / full 都会在对话框上方拉起原生计划评审卡（Web UI 的 plan-review），
   批准（`exit_plan_mode`）后才进入执行。
5. **接管官方胶囊**：原生计划模式激活期间（本插件桥接中，或你手动 `/plan`），官方那颗浅蓝「计划」
   胶囊会被隐藏（CSS 打到插槽容器 `[data-slot="conversation.input.plan"]`），改用本插件自己的动画
   图标表达状态。状态来自 `/api/plan-mode/state` 的 **`indicator`** 字段（唯一权威，四态）：

   | indicator | 何时 | 视觉 |
   |---|---|---|
   | `off` | 计划模式未开启、也不在执行 | 中性色静止 |
   | `armed` | 已开启但**没有回合在跑** | 蓝色**静止 + 60% 不透明度**（笔搁纸面，行线全显） |
   | `planning` | 已开启且**回合进行中** | 蓝色**书写动画** |
   | `executing` | 计划已批准且**回合仍在跑** | 蓝色对勾/进度动画 |
   | `planned` | 计划已批准、回合已结束（30 分钟内；新回合开始即清除） | 蓝色**静止**（对勾 + 进度线） |

   **有状态时按钮会展开成「图标 + 文字」的小胶囊**：`计划` / `计划中` / `执行中` / `已计划`；`idle` 只有图标。官方胶囊被我们隐藏后，这是"我此刻在不在计划模式里"唯一的常驻可见信号。

  `armed` 与 `planning` 同色（同一个蓝），但**不透明度降到 60%**：计划模式开着不代表正在规划，避免图标一直空转；降到 60% 是为了在**静态截图**里也能和 `planning` 区分开（只靠"动没动"的话，一张截图看不出差别，容易被误当成卡死）。
   因为胶囊本身是原生的退出按钮，退出入口移到面板里的「原生计划模式 · 退出」（等价 `/plan off`）；
   手动输入 `/plan` / `/plan off` 照旧可用。
   *注意*：`data-slot` 是 Web 壳的 DOM 约定，不属于插件契约；将来若改名，最坏退化为两颗入口并列，
   功能不受影响。

## 面板

| 控件 | 取值 | 作用 |
|---|---|---|
| 档位 | 关闭 / 轻量 / 全量 | 关闭=不干预；**轻量=桥接**（DSH 原生计划模式全权负责，本插件不注入任何文本）；**全量=桥接 + 我们的执行层**（计划走原生评审卡，批准后注入 PHASE 2 / P0-EXEC / 验收纪律） |
| Max | 开 / 关 | 额外注入「不用担心预算，你的 Token 是无限的」，抑制模型在预算受限时提前收手；与档位解耦（关档 + Max 也生效） |
| 生效范围 | 每次 / 自动 / 仅首轮 | 每次=每回合都先计划；自动=首轮必计划，之后只在长指令或含「改/重做/重构/重新…」等措辞时重规划；仅首轮=只有第 1 回合 |

**两个入口，两个作用域**（0.5.1 起）：

| 入口 | 作用域 | 说明 |
|---|---|---|
| 输入框旁的图标面板 | **当前对话** | 标题为「计划模式 · 本对话」；这里的改动只写给这个对话，改过之后就固定按这个对话自己的设置走（面板不提供"恢复默认"入口；服务端仍保留 `reset` 能力给脚本用）。 |
| 设置 → 计划模式 | **全局默认** | 这里的改动写入全局默认，**对新开的对话生效**；已经在面板里单独设置过的对话不受影响。 |

原有的「仅本会话」勾选框已移除：面板天然只作用于当前对话，不再需要那枚开关。

## 与 DSH 原生计划模式的关系（0.5.0 混合工作）

0.5.0 起不再和原生计划模式并排抢流程，而是**站在它上面**：

| 档位 | 谁管"计划" | 谁管"执行" |
|---|---|---|
| 关闭 | 谁都不管（本插件不干预） | — |
| 轻量 | **原生** `dsh-plan-mode`：`plan:policy` 政策段、`/plan off`、`exit_plan_mode`、计划评审卡 | 原生（批准后按模型自身习惯执行） |
| 全量 | **原生**（同上，同一个评审卡） | **本插件**：批准后投递 `PHASE 2`，要求 `P0-EXEC.yml` 与逐条验收 |

桥接靠 `planMode.set(agent, true)`（原生服务方法）完成，不模拟 UI 点击：

- 回合开始时按档位进档；切到「关闭」时把它关掉复位；
- **只有本会话还没真正规划过时才弹评审卡**（全量档第一次规划弹一次，之后沿用 0.4.x 的自动续跑），
  避免 `scope=每次` 变成"每回合都要点一次批准"；
- `plan/mode` 事件翻到 `false`（即 `exit_plan_mode` 被批准）时，全量档立即投递 PHASE 2，
  所以**批准与执行在同一个回合里衔接**，不会多跑一圈；
- 环境里没有 `planMode` 服务（如精简 profile）时自动回退 0.4.x 的注入式行为，不会失效。

**已知取舍**：light 档不再有本插件的验收纪律，只有原生政策；想要 `P0-EXEC` 就选全量。

## 验收产物

`tier=light/full` 的协议要求把验收清单落成 `P0-EXEC.yml`，键名**定死**（脚本可解析）：

```yaml
version: 1
summary: { total: 12, passed: 12, failed: 0 }
checks:
  - id: C1
    assert: "one line: what this check proves"
    run: "exact shell command"
    expect: "observable result: stdout text or exit code"
    measured: "the value you actually observed"
    result: pass
```

执行后每一行都要回填 `measured` 与 `result`（不只是失败项），并让 `summary` 与之一致。
计划文件本体固定在 `.plan-mode/plan.md`（只认这个目录下的产物）。

## 设置存在哪

| 文件 | 内容 |
|---|---|
| `$DSH_HOME/plan-mode-ui/state.json` | 全局默认 `{tier, scope, max}` + 各会话覆盖 `sessions{<id>:{...}}`（上限 50 条；与默认等值时自动删除） |
| `$DSH_HOME/plan-mode-ui/sessions.json` | 已经规划过的会话（`scope=first` 用），上限 1000 |

两个文件都是 tmp + rename 原子写。

## HTTP 契约

- `GET  /api/plan-mode/state?session=<id>` → `{ok, tier, scope, max, settings{source,overrides,default}, updatedAt, phase, session, phases[], planning, debug{}}`
- `POST /api/plan-mode/state?session=<id>` body `{tier?, scope?, max?}` → 同上（带 `?session` 写会话覆盖，不带写全局默认）

只接受同源 + `application/json`；非法值 400，非 JSON 415，超大 413（按字节计上限 8192），跨站 403。

写操作（POST）还必须带自定义头 `x-plan-mode-client: 1`——浏览器跨站页面发不出这个头（会先触发预检，
而本端点不返回任何 CORS 头），所以 `curl -X POST` 之类没带头的请求会拿到 403。GET 只读，无此要求。
写文件走临时锁（`state.json.lock`）+ 写前以磁盘为准重载，多个实例（桌面端 + CLI）同时改不会互相覆盖。

## 无头 / CI 场景（`DSH_PLAN_MODE_UI_HEADLESS=off`）

无头会话（`dsh headless`、CI 跑批）没有"计划审批"的 UI 通道，`exit_plan_mode` 会直接报：

```
Error: no user-questions answerer accepted the request
```

于是 light/full 会**卡在规划阶段**拿不到执行结果（实测：off 档能把文件写出来，light/full 写不出来）。

设一个环境变量即可让插件在这些进程里表现得像 off（不桥接、不注入、不碰原生计划模式），Web 端不受影响（该变量只在设了的进程里生效）：

```bash
DSH_PLAN_MODE_UI_HEADLESS=off dsh headless "把 1+1 写进 /tmp/x.txt"
```

实测同一任务：

| 档位 | 不设开关 | 设 `DSH_PLAN_MODE_UI_HEADLESS=off` |
|---|---|---|
| off | 写出文件 ✅ | 写出文件 ✅ |
| light | 卡在审批 ❌ | 写出文件 ✅ |
| full | 卡在审批 ❌ | 写出文件 ✅ |

`GET /api/plan-mode/state` 的响应里带 `headless: true` 与 `debug.headless`，便于确认降级是否生效。

## 已知限制

1. 会话行按会话 id 存，会话被删后条目会残留，靠 **50 条上限 + LRU 淘汰**（最久未写的那条先丢）。
2. 全局默认改动**不会**清理与默认等值的会话行——那些行是用户对该对话的显式选择。
3. `bash` 里写文件不算「写工具」，拦门识别不到。
4. DSH 0.2.x 的实际顺序是 `turn/start` → `user/message`（用户输入落在回合内），插件按「开口那条 user/message」判定本回合是否由用户开启；先 `user/message` 后 `turn/start` 的旧顺序也保留兼容路径。
5. `turn/end` 缺失时，`activeTurns` 靠 6 小时兜底失效。
6. 关档只影响「要不要开始规划」，**不会中断已经开始规划的回合**（要中断按停止）。
7. **安全边界**：能直连 `127.0.0.1:<port>` 的本机进程可以读这个端点（只读信息：档位/阶段，不含任何密钥）。
   本插件不把它当安全边界——本机进程本来就能直接改 `$DSH_HOME/plan-mode-ui/state.json`。端点层面挡的是
   浏览器跨站 CSRF 与顺手 `curl`。
8. **安装位置**：请用 `dsh plugin --profile web add <tarball>` 装。**不要**用 `file:` 指向桌面/临时目录的
   tgz —— pnpm 会把依赖记成 `file:C:/Users/.../Desktop/xxx.tgz`，那个文件一旦移动/删除，profile 就装不回来。
   要留在本机就先把 tgz 拷到 `$DSH_HOME/plugins/` 再 `add`。

## 卸载

```bash
dsh plugin --profile web remove dsh-plan-mode-ui
```

重启即可；`$DSH_HOME/plan-mode-ui/` 下的两个状态文件可以留着（重装后继续用）或直接删。

## 兼容性

- DSH `>= 0.2.1-rc`，web profile（`dsh.client.platform = web`）。
- 宿主半端只用 `node:fs` / `node:zlib` / `@deepseek-ai/dsh-llm`；客户端半端只 require `react`。
- 与内置 `/plan` 共存：内置 plan 生效时本插件让路，不抢流程。
- 桌面端 profile 若在 `compatibility.json` 里给 `dsh-git-bash-shell` 之类留了版本豁免，与本插件无关；
  升级 DSH 后检查那份豁免是否仍对应真实安装版本。
- `tier=light/full` 的协议**要求**模型落盘验收产物（`P0-EXEC.yml` / `.plan-mode/plan.md`），这是有意副作用：
  档位不只是"提示词风格"，它会改变工作区里的文件。不想留文件就把档位调成 `off`。

## 与 agent 预设有何关系（lean v3 / PTC）

本插件在任何预设下都能工作，但有两件事会真实改变它的行为，值得单独说清楚。

**1. 两套「计划模式」可以同时存在。** 预设里常带着官方的 `@deepseek-ai/dsh-plan-mode` 组件（`exit_plan_mode` 那一套，需要人点批准）。只要它在本回合生效，本插件就主动让路，不抢流程、不重复投递 PHASE 2。所以同一个界面上可能有两套计划模式在，判断谁在管看面板顶部那行状态。

**2. PTC 会换掉「动手」的工具名。** 预设 `flash-lean-ptc-v3` 里 `agent-tool-presentation` 用 `mode: ptc`，模型改文件的动作是**在 `run_code` 里调 `write`/`edit`**，而不是直接调 `write`。所以「规划期有没有偷偷动手」不能看工具名——v0.4.1 起改成：**计划文件（`.plan-mode/plan.md`）落地之后，统计后续工具调用次数**（阈值 2）。这个判据是从真实会话回放里定的：樱花树会话计划写在第 5 步、体素建筑写在第 9 步；换成新判据后，旧逻辑那个「第 62 步才投递 PHASE 2」的迟到彻底不再出现。

**3. lean v3 的 13 条硬规则里，有三条和本插件直接对话：**

| 规则 | 原文要点 | 对本插件的含义 |
|---|---|---|
| 1 | 目标 ≤20 轮，超预期 3 倍就重新规划 | PHASE 2 不能说「继续深挖」，否则和轮数预算打架；它写的是「收尾」 |
| 4 | 交付前一次性过闸，过闸即停，不追加随机/压测轮 | 执行阶段只做一次集中验收，不要连跑多轮"再确认一下" |
| 7 | ≥3 个独立调用折进一个 `run_code` | 这就是 PTC 的来源，也是上面第 2 条判据必须绕开工具名的原因 |

完整规则原文和组件清单在 `~/.dsh/local-presets/flash-lean-ptc-v3.patch.yml`（13 条人设规则 + 工具/压缩/委派配置）。**换预设不需要改插件**，但如果新预设改了呈现模式（比如从 PTC 切回原生工具），第 2 条判据要重新验一遍。

## v0.5.2（未发布）：计划状态以会话投影为准

**症状**：一直开着计划模式，却每轮都不出计划、也不弹审批。

三个缺陷不在同一层，叠在一起才让它看起来"完全没生效"：

**1. 状态读的是簿记，不是真相。** 判断"原生是否在跑"以前只看本地簿记（`nativeOpen` /
`bridgeTier`）。只要漏采样一次 `plan/mode` 事件，簿记就永久陈旧，D2 的守卫于是每轮都判定
"已在计划模式里"→ 直接 `return`，既不重发 `/plan` 也不注入。现在优先读会话投影
`stateOf(session,"plan").active`；并补上 `ctx.get("sessionProjections")` 探测（预设
`isolate` 时 `ctx.sessionProjections` 属性可能拿不到）；两者不一致时按真相自愈
（`gate.reconcile` 计数）。

**2. 读不到真相时不该抑制。** 投影确实不可用（`debug.plan.available=false`）时当作"未知"，
每轮重发一次幂等的 `/plan`——把计划模式从"记住的状态"改成"每轮重新断言"。这是唯一在信息
不足时仍然正确的选择。

**3. 系统提示段的让位判据同样错。** 原来只看 `bridgeTier`，重启后它是空的 → light/full
档都把 `ACCEPTANCE` + `P0-EXEC.yml` + "然后实现并跑验收"注入进去，与原生 `plan:policy`
的"只读、只出计划、用 exit_plan_mode 提交"**直接对冲**，模型自然挑那份让它干活。现在让位
判据同样以投影为准，light 档无条件不注入（纯桥接语义本来就不该有验收文本）。

**4. 指示器第二段的相位判定犯了同一类错。** 批准分支的门闸写的是 `bridgedTier === "full" ||
"light"`——只要没桥接过（投影说已开时我们确实不桥接），档位是 light/full 也判不成"批准"，
于是 `plannedAt` 不写、`executing` 记录不建，`indicatorOf` 一路落到 `return "off"`，客户端拿到
`data-phase='off'` 用默认前景色 `#111827`（近黑）——这就是"讲划完成后标志变回黑色"的来源。
现在门闸改看会话档位 + `cancelIntent`，并且 `planned` 在 `indicatorOf` 里提到 `armed` 之前，
PHASE 2 的投递判据也从簿记改成档位。

**5. 新增「自动批准」开关（设置页 · 计划模式）。** 开启后 `exit_plan_mode` 的评审自动通过、
直接进入执行，不再等人工点「批准」。实现是注册 `user-questions/request` **瀑布监听器**：
`exit_plan_mode` 的评审正是走这条瀑布征询的，命中即返回 `{answers:[{id:"plan-review",selected:[approve]}]}`
短路后续答题器（含 Web 评审卡）。约束是刻意的：只认 `intent.kind === "plan-review"`、请求里必须
**恰好一个问题**、批准标签取自问题本身的 `intent.approve`（不硬编码 `"Approve"`）、子代理会话不答、
已取消请求不答、任何异常都 `next()` 退回人工（**fail-open：宁可弹卡，不可误批**）。档位为「关闭」时
开关置灰且不触发。默认关闭；状态里用 `autoApprove` 与 `debug.auto = {approved,skipped,failed}` 自检。

**自检口径（重要）**：本轮的 `system/message` 里 `grep ACCEPTANCE` 应当**查不到**；查得到
说明冲突回归了。计划模式的真值是 `debug.plan.active`，不是面板图标。`gate.reconcile > 0`
表示发生过一次自愈。

**测试**：新增 A9–A13（簿记陈旧时自愈、投影已开不重发、读不到投影仍重发、段让位、段恢复）、
I14–I16（无簿记时批准→executing→planned、空闲期保持、新回合让位）与 `test/auto-approve.mjs` 8 项
（自动批准正例 + 关/档位关/普通提问/多问题/已取消/子代理/读写 reset），全套 **113 项**。**调试脚本**统一收在 `~/.dsh/scripts/plan-mode-ui/`（`pm-wb.yml`、`pm-e2e.sh`、
`pm-gate.sh`、`pm-selfcheck.sh`、`pmlog*.mjs`）。

## v0.5.1（未发布）：一次全量逻辑审计的修复

**1. 「关闭」与「退出原生计划模式」判据不一致（D1）。** 下一回合开头的路径只关插件自己开的桥接，而切档时的写路径把用户手动 `/plan` 开的也一起关掉。现在两条路径统一为「只关插件自己开的」；用户手动开的原生计划归 `action=plan-off` 管，也不再越权清 `nativeOpen` 簿记。

**2. 原生已在跑时仍会注入 PHASE 1（D2）。** 原来靠 `planMode.loggedActive` 判断，而预设把这个服务 isolate 了 → 守卫恒为 false（实测 `gate.builtin` 一直 0）。现在把「会话投影里的 plan 状态」和 `nativeOpen` 一起作为判据：原生已经在跑就只沿用，不再注入第二套纪律，也不再白发一次 `/plan`。

**3. 重启后不重建原生状态（D3）。** `nativeOpen` 只由 `plan/mode` 事件填充，DSH 重启时若会话本就在计划模式，界面会按「未开启」渲染。现在 `agent/created` 时按会话投影校准一次，`builtinPlanActive` 也直接读投影（服务被 isolate 时仍能拿到真相）。

**4. 退出通道合并成一份实现（C1）。** `action=plan-off` 以前手写 `defer(runPlanCommand)`，丢掉 `svc.set` 快路径、命令计数与失败纠正；现在统一走 `nativeLeave`。

**5. 「退出」不再被当成「批准」（D4），并且退出入口与「关闭」档合一。** 全量档下原生计划模式退出有两条来路：`exit_plan_mode` 批准，和用户自己退出。之前两者走同一分支——**点「退出」等于批准**，插件会立刻投递执行阶段。现在用 `cancelIntent` 标记主动退出：取消时清掉计划记录、不记"已计划"、不投递 PHASE 2；按钮文案也按档位区分（轻量「退出计划模式」/ 全量「取消本次计划」）。

**6. 卫生（H1/H2）。** `decidedTurn`/`turnOpening` 随 `agent/disposed` 回收，`decidedTurn` 加上限；`plannedAt` 纳入 `pruneStale` 的 TTL 清理。

回归：新增 `test/audit-fixes.mjs`（A1–A5，对应 D1/D1/D2/D3/H1），全套 **92 项通过**。

## v0.4.3：审计补的两个漏（同属「仅本会话」会失灵）

**1. 会话覆盖有上限（50 行），清理时按插入顺序丢最早的——钉住的行也会被丢。**
会话一多，用户显式钉住的设置会凭空消失，表现就是「我明明勾了仅本会话，它却不认」。
现在清理时优先丢非钉住行，钉住行最后才丢。

**2. 同一个请求里既取消钉住又带值，值会被静默丢弃。**
改成：删掉会话行后，把这次带的三项当作全局改动写下去。

回归用例 H10、H11；目前 64 项全绿。

## v0.4.2：修「仅本会话」被全局覆盖

现象：在 A 会话勾上「仅本会话」，去别的会话改全局，A 的值还是被改掉了——面板上勾选还亮着，但没起作用。

根因：钉住只记「你在这里改过的那几项」。只勾了复选框、没同时调值的话，会话行里只有 `pinned: true`，
其余字段照样跟着全局默认走，所以后来的全局改动会漏进来。

现在钉住 = **整份冻结**：

- 写入钉住行时，会把当时生效的 tier / scope / max 三项一起写进去（不只是这次改的那项）；
- 加载旧状态时，早期版本留下的半截钉住行按当时的默认补齐，一次性迁移；
- 取消勾选仍然删行、回到跟随全局。

顺带把 `GET /api/plan-mode/state` 的 `phases[]` 补上 `callsAfterPlan` / `resumedByWork`，排查「这次为什么没续跑」不用再翻日志。

回归用例 H1–H9（含「只勾复选框也会冻结」「旧格式行迁移」「值等于全局也仍然钉住」），目前 64 项全绿（v0.4.2 时是 62）。

## v0.4.1：两个实测出来的时序问题

拿两个真实会话（一棵程序化樱花树、一座体素古建群）回放日志后改的两处：

**1. 计划交付后模型没停步时，不再「事后催办」**

原来的 PHASE 2 只挂在回合收尾的钩子上。樱花树那轮模型写完计划就停了，注入即时（第 5 步）；
但体素那轮模型写完计划一路连做到第 62 步才停，于是「开始执行」的指令在 38 分钟后才送到，
结果是同一份交付被汇报了两遍。

现在会在规划阶段探测计划文件（不依赖工具名，`run_code` 里写文件也算），
只要计划已落地、之后又调用了 ≥2 次工具，就认定它已经在执行：收尾时静默把阶段切到 `executing`，不再注入。
只调用 1 次工具就停的情况仍然照旧续跑。

**2. 「扩大到十倍」这类量级指令会触发重规划**

`scope=auto` 原本只认「≥30 字」或「改/重做/重构…」这类措辞。用户那句
「提高精度和规模，至少扩大到当前的10倍以上」只有 21 字、也不含那些词，于是一个十倍规模的活直接开干，没写计划。

现在阈值降到 `20` 字，词表补了量级与强度类词：扩大 / 扩到 / 放大 / 翻倍 / 倍 / 规模 / 精度 / 全量 / 整体 / 彻底 / 性能 / 升级 / 细化 / 增强。

两条都有回归用例（`test/features.mjs` 的 C5–C7、E6–E7），目前 53 项全绿。

回放那两个真实会话的日志（按原 stop 点驱动收尾钩子），新旧逻辑的差别是：

| 会话 | 旧逻辑 | 0.4.1 |
|---|---|---|
| 樱花树（计划在第 5 步） | 第 5 步注入 PHASE 2 | 第 5 步注入（行为不变） |
| 体素建筑（计划在第 9 步，第 62 步才停） | 第 62 步注入，迟到约 38 分钟 | **不注入**，阶段直接转 `executing` |

## v0.4.0：移除「执行前确认」（人工审批）

`gate`（执行前确认 / 人工审批）整套删掉了，发布版不再有这一项：规划阶段结束就直接进执行阶段，
不再拦写操作、不再弹「执行 / 改计划 / 停止」的确认卡。规划协议、阶段推进、验收产物要求保持不变。

删掉的东西：host 侧 `tools/pre-execute` 与 `tools/post-execute` 两个钩子、`gateActive`、
`approvals` / `gateStrikes`、写动作启发式（`BASH_WRITEISH_RE` / `CODE_WRITEISH_RE`）、
`GATE_DENY` / `PHASE_NEED_APPROVAL`、`clientSeenAt` 活性时间戳；状态 API 里的 `gate` / `gateActive` 字段；
设置页的「执行前确认」开关。

兼容性：旧 `state.json` 里残留的 `gate` 字段会被**静默忽略**（不报错、不迁移，下次保存即消失），无需手工清理；
客户端若仍拿到带 `gate` 的响应也只是无视它。

副作用（如实说明）：会话里不再有「先批准再动手」的停顿，模型写完计划会立刻开始改文件。
要人工把关，请用 DSH 自带的权限模式/审批，而不是本插件的门。

**设置页分区**：设置左侧导航新增「计划模式」一栏，可调强度、生效范围、Max 模式与「仅本会话」，与浮层面板共用同一份状态。

**修复**：勾选「仅本会话」后来回切换档位，面板标题会掉回「全局」。根因是旧实现用
"生效值是否等于全局默认"来判断来源，值一旦回落到默认就删掉本会话行。现在改为显式
`pinned` 语义——勾上就记住这一行（即使值与默认相同），取消勾选才删。

## English summary

Two-phase plan mode for the DSH web GUI. The host half splits each turn into a planning phase and an execution phase, injects a planning protocol through `ctx.systemPrompt`, and — when the model stops at the end of planning — steers a `PHASE 2` message into the same turn so execution continues without a second user message. The browser half is a composer icon plus an upward panel (tier, scope, Max mode, per-session override). State lives in `$DSH_HOME/plan-mode-ui/`.
There is **no manual approval step** (the `gate` feature was removed in v0.4.0): planning flows straight into execution.

It coexists with the built-in `@deepseek-ai/dsh-plan-mode` component (it yields when that one is active) and with PTC-style presets such as `flash-lean-ptc-v3`, where file edits happen inside `run_code` — which is why the "did it already start working?" check keys on the plan file landing plus the number of tool calls after it, not on tool names. See 「与 agent 预设有何关系」 above.