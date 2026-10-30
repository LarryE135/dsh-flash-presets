// Host half of dsh-plan-mode-ui: plan-tier state + system-prompt section + HTTP API.
//
//   GET  /api/plan-mode/state  -> { ok, tier, scope, updatedAt, phase, planning, debug }
//   POST /api/plan-mode/state  { tier?, scope? }  -> same shape
//
// The browser half (lib/client.js) draws the composer entry and panel; this half
// keeps the value on disk so it survives reloads and reaches the model through
// ctx.systemPrompt.

import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, statSync, readdirSync, openSync, readSync, closeSync, unlinkSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { homedir } from "node:os";
import { join } from "node:path";

const API = "/api/plan-mode";
const TIERS = new Set(["off", "light", "full"]);
const SCOPES = new Set(["always", "auto", "first"]);
// scope=auto：首轮必规划；之后只在「任务明显变了」时重规划（长指令或改方案类措辞）
const REPLAN_RE = /(改|重做|重写|重构|重建|推翻|重新|不够|不对|换方案|大改|返工|扩大|扩到|放大|翻倍|倍|规模|精度|全量|整体|彻底|性能|升级|细化|增强|refactor|rework|rebuild|rethink|redo)/i;
// 第 2 回合起，多长的输入才值得重规划（原来 30 字，对“扩大到十倍”这类短指令太钝）
const REPLAN_MIN_CHARS = 20;
// 计划落地后仍在调工具的探测节流（每次 tool/call 都 stat 一遍目录没必要）
const PLAN_PROBE_MS = 1000;
// 计划交付后还调了这么多次工具 → 它其实已经在执行，收尾时别再催一遍
const ALREADY_EXECUTING_CALLS = 2;

// P0-EXEC.yml 的键名定死：之前两次试跑分别写成 measured: 和 result:{stdout,exit,status}，
// 导致"回填实测值"这一步没法被脚本统一校验。这里给出唯一 schema。
const P0_SCHEMA = "P0-EXEC.yml uses exactly these keys (tooling parses them — do not rename, and do not nest them differently):\n```yaml\nversion: 1\nsummary: { total: 12, passed: 12, failed: 0 }        # fill after running\nchecks:\n  - id: C1\n    assert: \"one line: what this check proves\"\n    run: \"exact shell command\"\n    expect: \"observable result: stdout text or exit code\"\n    measured: \"the value you actually observed\"        # fill after running\n    result: pass        # pass | fail -- fill after running\n```\nAfter execution, fill `measured` and `result` on EVERY row (not only the failing ones) and keep `summary` consistent with them.";

const COPY = {
  off: null,
  light: [
    "PLANNING (tier=light). Before writing code, produce two small artifacts in the working directory:",
    "1. P0-EXEC.yml — 8 to 14 executable acceptance checks. Every check must be runnable by a command; no prose-only checks.",
    "2. CONVENTIONS.md — at most 20 rows, columns: ID | 约定 | 一句理由 | 违规如何被测出.",
    P0_SCHEMA
  ].join("\n"),
  full: [
    "PLANNING (tier=full). Stage 1 — EVIDENCE.md: list every FACT / CONVENTION / AMBIGUITY / EDGE you rely on and tag each one as ✅可命令 (a command can confirm it), 👁只能看图 (only visual), or 🤷不知道 (must probe first).",
    "Stage 2 — copy only the ✅ items into P0-EXEC.yml (same fixed keys as the schema below, plus a source field pointing at the EVIDENCE row), move 👁 items to P1-TARGETS.yml, and probe every 🤷 item before planning on top of it.",
    P0_SCHEMA
  ].join("\n")
};

function dshHome() {
  const v = process.env.DSH_HOME;
  return v !== undefined && v !== "" ? v : join(homedir(), ".dsh");
}
const storePath = () => join(dshHome(), "plan-mode-ui", "state.json");

// ── 无头降级开关 ────────────────────────────────────────────────────
// 无头会话（dsh headless / CI）没有"计划审批"的 UI 通道，exit_plan_mode 会报
//   no user-questions answerer accepted the request
// 于是 light/full 会卡在规划阶段、永远拿不到执行结果。设 DSH_PLAN_MODE_UI_HEADLESS=off
// 即让插件在这些进程里表现得像 off（不桥接、不注入），工作照常完成。
// 未设置 = 保持原行为（Web 端不受影响）。
const HEADLESS_ENV = "DSH_PLAN_MODE_UI_HEADLESS";
function headlessForced() {
  const v = String(process.env[HEADLESS_ENV] ?? "").trim().toLowerCase();
  return v === "off" || v === "0" || v === "false" || v === "no";
}

const SETTINGS_MAX = 50;                  // 每会话覆盖条数上限
const pickTier = (v) => (TIERS.has(v) ? v : undefined);
const pickScope = (v) => (SCOPES.has(v) ? v : undefined);
// 设置分两层：default（全局默认）+ sessions（按会话覆盖）。
// 旧格式 { tier, scope } 自动迁移成 default，会话覆盖为空。
function load() {
  const fallback = { default: { tier: "light", scope: "always", max: false, autoApprove: false }, sessions: {}, updatedAt: null };
  try {
    const raw = JSON.parse(readFileSync(storePath(), "utf8"));
    if (raw === null || typeof raw !== "object") return fallback;
    const dfltRaw = raw.default !== null && typeof raw.default === "object" ? raw.default : raw; // v1 兼容
    const sessions = {};
    if (raw.sessions !== null && typeof raw.sessions === "object") {
      for (const [id, v] of Object.entries(raw.sessions)) {
        if (typeof id !== "string" || id.length === 0 || v === null || typeof v !== "object") continue;
        const tier = pickTier(v.tier), scope = pickScope(v.scope);
        const max = typeof v.max === "boolean" ? v.max : undefined;
        const autoApprove = typeof v.autoApprove === "boolean" ? v.autoApprove : undefined;
        // 0.5.1 起没有"钉住"概念：只要这一行有任何取值，它就是用户对这个对话的显式设置。
        // （旧版 pinned 字段只被读一次，不再写回。）
        if (tier === undefined && scope === undefined && max === undefined && autoApprove === undefined) continue;
        sessions[id] = {
          ...(tier === undefined ? {} : { tier }),
          ...(scope === undefined ? {} : { scope }),
          ...(max === undefined ? {} : { max }),
          ...(autoApprove === undefined ? {} : { autoApprove })
        };
      }
    }
    const dflt = { tier: pickTier(dfltRaw.tier) ?? "light", scope: pickScope(dfltRaw.scope) ?? "always", max: dfltRaw.max === true, autoApprove: dfltRaw.autoApprove === true };
    // 每个会话行都整份冻结：早期版本只记用户动过的那几个字段，其余跟着默认走，
    // 于是"别的会话一改全局，这个对话也被带着跑"。缺项按当前默认补齐一次。
    for (const over of Object.values(sessions)) {
      if (over.tier === undefined) over.tier = dflt.tier;
      if (over.scope === undefined) over.scope = dflt.scope;
      if (over.max === undefined) over.max = dflt.max;
      // 注意：autoApprove 故意**不补齐**。它是"权限开关"而不是"这个对话的调参"，
      // 补齐会在升级首次加载时把当时全局值烤进所有既有会话行，之后改设置页就再也影响不到它们。
      // 行里没有该字段时，settingsFor() 会落回全局默认 —— 这正是我们要的"跟随全局"。
    }
    return {
      default: dflt,
      sessions,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null
    };
  } catch {
    return fallback;
  }
}

let state = load();
const sidOfKey = (key) => (typeof key === "string" && key.startsWith("id:") ? key.slice(3) : null);
// 会话生效设置：会话覆盖优先，缺项落回全局默认
function settingsFor(key) {
  const sid = sidOfKey(key);
  const over = sid === null ? undefined : state.sessions[sid];
  return {
    tier: over !== undefined && over.tier !== undefined ? over.tier : state.default.tier,
    scope: over !== undefined && over.scope !== undefined ? over.scope : state.default.scope,
    max: over !== undefined && over.max !== undefined ? over.max === true : state.default.max === true,
    autoApprove: over !== undefined && over.autoApprove !== undefined ? over.autoApprove === true : state.default.autoApprove === true,
    // 只要有"本会话行"就是 session 来源：行的存在即"钉住本会话"，
    // 不能再用"值与默认是否相同"来推断（否则勾了仅本会话、值恰好等于默认时会被误判为全局）。
    source: over !== undefined ? "session" : "default"
  };
}
// 回合内两阶段，按会话独立：
//   planning  — 规划阶段：若干只读步，止于「计划落地 + 聊天里可见的计划」
//   executing — 执行阶段：按计划实现并逐条跑验收检查
const phaseRecords = new Map();        // session → { phase, steeredTurn, planningAt }
// scope=first 的“已规划”记忆：落盘，重启后仍然记得（键为 id 字符串）
const SESSIONS_PATH = () => join(dshHome(), "plan-mode-ui", "sessions.json");
const PLANNED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PLANNED_MAX = 1000;
const plannedSessions = loadPlanned();

function loadPlanned() {
  const map = new Map();
  try {
    const raw = JSON.parse(readFileSync(SESSIONS_PATH(), "utf8"));
    const rows = raw !== null && typeof raw === "object" && raw.planned !== null && typeof raw.planned === "object"
      ? raw.planned : {};
    const now = Date.now();
    for (const [key, ts] of Object.entries(rows)) {
      if (typeof ts === "number" && now - ts < PLANNED_TTL_MS) map.set(key, ts);
    }
  } catch (error) { /* 首次运行或文件损坏：空表 */ }
  return map;
}

function savePlanned() {
  try {
    mkdirSync(join(dshHome(), "plan-mode-ui"), { recursive: true });
    const tmp = SESSIONS_PATH() + ".tmp";
    const planned = {};
    for (const [key, ts] of plannedSessions) planned[key] = ts;
    writeFileSync(tmp, JSON.stringify({ version: 1, planned }, null, 2));
    renameSync(tmp, SESSIONS_PATH());
  } catch (error) {
    console.error("[plan-mode-ui] persist sessions failed:", error);
  }
}

function rememberPlanned(key) {
  if (key === undefined || key === null) return;
  const now = Date.now();
  plannedSessions.set(key, now);
  for (const [k, ts] of plannedSessions) {
    if (now - ts > PLANNED_TTL_MS) plannedSessions.delete(k);   // 过期清理
  }
  while (plannedSessions.size > PLANNED_MAX) plannedSessions.delete(plannedSessions.keys().next().value); // 有界
  savePlanned();
}

function forgetPlanned(key) {
  if (key === undefined || key === null) return;
  if (plannedSessions.delete(key)) savePlanned();
}
let lastSession = null;                // UI 轮询看“最近活跃会话”的阶段
const PLANNING_TTL_MS = 15 * 60 * 1000;

// 会话键：优先用 id 字符串，拿不到 id 才退回对象身份——
// session/event 给的 session 与 context.agent.session 未必是同一个对象
function sessionKey(session) {
  if (session === undefined || session === null) return undefined;
  const id = session.id !== undefined ? session.id
    : session.sessionId !== undefined ? session.sessionId
    : session.key !== undefined ? session.key : undefined;
  return id === undefined || id === null ? session : "id:" + String(id);
}
const agents = new Map();                 // sessionKey → Agent（用于中途纠正）
const userPrompts = new Map();            // sessionKey → { at, chars, head, used }：真实用户输入（used=已被某回合消费）
const activeTurns = new Map();            // sessionKey → 回合开始时间（此间收到的用户输入属“插话”，不授权新回合）
const pendingTools = new Map();           // sessionKey → 飞行中的工具调用数（>0 说明回合在跑，只是没事件）
const ACTIVE_TURN_MAX_MS = 6 * 60 * 60 * 1000; // 回合进行中的兜底时限（崩溃未发 turn/end 时自动失效）
// 本插件自己投递的 steer 消息一律以这些前缀开头：它们不是"真实用户输入"，
// 不给下一个回合发放规划许可（漏掉一个前缀 => 这条 steer 会被当成用户发话）。
const STEER_PREFIX_RE = /^(PHASE 2|PHASE 1|PHASE APPROVAL|PLAN NOT FOUND|PLAN FIRST)/;
const sectionStats = { evals: 0, hits: 0 }; // 自检：提示词装配是否看到当前阶段
let lastPlanCheck = { at: null, cwd: null, result: null }; // 自检：拦门在真实会话里能否拿到 cwd（全局兜底）
const planChecks = new Map();             // sessionKey → 该会话最近一次拦门结果（诊断用）
const WRITE_TOOL_RE = /^(write|edit|multi_?edit|apply_?patch|create_?file|delete_?file|move_?file|rename_?file)/i;
function recordFor(session) {
  const key = sessionKey(session);
  return key === undefined ? undefined : phaseRecords.get(key);
}
function touchSession(session) {
  if (isSubagent(session)) return; // 子代理不抢 UI 的“当前会话”
  const key = sessionKey(session);
  if (key !== undefined) lastSession = key;
}
function pruneStale() {
  const now = Date.now();
  // H2：「已计划」标记只在读取时判 TTL，长期没人看的会话会一直挂着条目
  for (const [k, at] of plannedAt) { if (now - at > PLANNED_ICON_TTL_MS) plannedAt.delete(k); }
  for (const [key, rec] of phaseRecords) {
    if (now - rec.planningAt <= PLANNING_TTL_MS) continue;
    // 回合仍在进行（例如一次 20 分钟的工具调用，期间没有任何事件）：保留记录，
    // 否则 PHASE 2 永远不会被投递，这一回合就白规划了。
    // 有工具调用仍在飞行（一次 20 分钟的渲染就是这样）：回合是活的，不能清
    if ((pendingTools.get(key) ?? 0) > 0) continue;
    phaseRecords.delete(key);
  }
  for (const [key, at] of activeTurns) {
    if (now - at > ACTIVE_TURN_MAX_MS) activeTurns.delete(key);
  }
}
// 计划文件是否落地：只读检查，读不到就当作没有
// 认可的计划落点：模型未必用我们指定的路径，所以几个常见落点都算数
// 会话工作目录：先看运行对象上的字段；都没有就从磁盘会话头里取（生产环境实测 session.cwd 为 undefined）
// 会话头（磁盘首帧）里带 cwd 与 delegationDepth：运行对象上没有这些字段时用它兜底
const headerCache = new Map();
const headerMiss = new Map();  // 未命中的重试节流
const CACHE_MAX = 500;         // header/cwd 缓存按会话增长，必须有界
function capSet(map, k, v) {
  if (map.size >= CACHE_MAX && !map.has(k)) map.delete(map.keys().next().value);
  map.set(k, v);
}
// 只读文件开头的一小段并解出首帧：会话日志是多帧 zstd 且会一直变长，
// 整文件 read + 整文件解压既慢又必然失败（实测多帧报 Unknown frame descriptor）。
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const HEAD_CHUNK = 256 * 1024;
function firstFrameText(file) {
  let fd;
  try {
    fd = openSync(file, "r");
    const chunk = Buffer.alloc(HEAD_CHUNK);
    const n = readSync(fd, chunk, 0, HEAD_CHUNK, 0);
    if (n <= 0) return null;
    const buf = chunk.subarray(0, n);
    const end = buf.indexOf(ZSTD_MAGIC, 4);          // 第二帧的起点
    const candidates = [];
    if (end > 4) candidates.push(buf.subarray(0, end)); // 首选：恰好第一帧
    candidates.push(buf);                            // 次选：整段（单帧会话）
    for (const slice of candidates) {
      try { return zstdDecompressSync(slice).toString("utf8"); } catch (error) {}
    }
    return null;
  } catch (error) {
    return null;
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch (error) {} }
  }
}
function sessionHeader(session) {
  const id = session !== undefined && session !== null
    ? (session.id !== undefined ? session.id : session.sessionId) : undefined;
  if (id === undefined || id === null) return null;
  const k = dshHome() + "|" + String(id); // 带上 home，避免不同 DSH_HOME 之间串味
  if (headerCache.has(k)) return headerCache.get(k);
  // 失败节流要在读盘之前判：否则每次装配都会重新读一遍文件
  const missedAt = headerMiss.get(k);
  if (missedAt !== undefined && Date.now() - missedAt < 30000) return null;
  let head = null;
  try {
    const root = join(dshHome(), "sessions");
    for (const dir of readdirSync(root)) {
      const file = join(root, dir, "session-" + String(id), "session.v4.jsonl.zstd");
      if (!existsSync(file)) continue;
      const text = firstFrameText(file);
      if (text === null) continue;
      const first = text.split("\n")[0];
      const meta = JSON.parse(first);
      head = {
        cwd: typeof meta.cwd === "string" && meta.cwd.length > 0 ? meta.cwd : null,
        delegationDepth: typeof meta.delegationDepth === "number" ? meta.delegationDepth : 0
      };
      break;
    }
  } catch (error) { head = null; }
  // 命中才长缓存；没找到时 30 秒内不再重试（会话头可能稍后才落盘）
  if (head !== null) { capSet(headerCache, k, head); headerMiss.delete(k); }
  else capSet(headerMiss, k, Date.now());
  return head;
}
// 内置计划模式（/plan）是否正在生效：生效时不抢它的流程
let planModeService;
// 会话投影里的真实计划状态（planMode 被 isolate 时这是唯一可靠来源）
function planProjection(ctx, session) {
  try {
    // 服务可能挂在 ctx 属性上，也可能只能通过 ctx.get 拿到（取决于 isolate）
    let proj = null;
    try { if (typeof ctx.get === "function") proj = ctx.get("sessionProjections") ?? null; } catch (error) { proj = null; }
    if (proj === null || proj === undefined) proj = ctx.sessionProjections;
    if (proj !== null && proj !== undefined && typeof proj.stateOf === "function") {
      const st = proj.stateOf(session, "plan");
      if (st !== null && st !== undefined && typeof st.active === "boolean") return { available: true, active: st.active };
    }
  } catch (error) { /* 没有该投影 */ }
  return { available: false, active: false };
}

function builtinPlanActive(ctx, session) {
  try {
    if (planModeService === undefined || planModeService === null) { // 服务可能稍后才注册
      planModeService = typeof ctx.get === "function" ? (ctx.get("planMode") ?? null) : null;
    }
    if (planModeService !== null && typeof planModeService.loggedActive === "function") {
      return planModeService.loggedActive(session) === true;
    }
  } catch (error) { planModeService = null; }
  // D3：planMode 被预设 isolate 掉时（本次部署就是这样），服务拿不到，但"计划是否生效"
  // 本身是会话投影里的数据 —— loggedActive() 内部也是读它。直接读同一份，结论才一致；
  // 否则这个守卫恒为 false，full 档会在用户手动 /plan 之后再注入一段 PHASE 1。
  try {
    const proj = ctx.sessionProjections;
    if (proj !== null && proj !== undefined && typeof proj.stateOf === "function") {
      const st = proj.stateOf(session, "plan");
      if (st !== null && st !== undefined && typeof st.active === "boolean") return st.active;
    }
  } catch (error) { /* 没有该投影 → 按未激活处理 */ }
  return false;
}

// ── 原生计划模式桥接（0.5.0 混合工作）──────────────────────────────────────
// light：纯桥接 —— 不注入任何 PHASE 文本，DSH 自带 plan mode 全权接管
//        （政策段 / /plan off / exit_plan_mode / 对话框上方的计划评审卡）。
// full ：桥接 + 我们的执行层 —— 计划同样走原生评审卡，批准（plan/mode -> false）
//        之后再投递 PHASE 2，执行纪律仍由本插件提供。
// DSH 0.2.x 的回合顺序是 turn/start → user/message，用户输入落在回合内，
// 所以"这个回合是不是用户开启的"必须在收到 user/message 时判定（turnOpening）。
const turnOpening = new Map();         // sessionKey → 本回合还没有助手输出/用户输入
const decidedTurn = new Map();         // sessionKey → 已决策过的回合号（异步桥接期间的并发保护）
function decidePlanning(ctx, session, key, evTurn, prompt) {
  // turn/start 与 user/message 两条路径可能在同一回合先后进来，而桥接是异步的：
  // 用同步写入的回合号做幂等，避免同一回合进两次计划模式。
  if (evTurn !== undefined && decidedTurn.get(key) === evTurn) { gateStats.seen += 1; return; }
  if (evTurn !== undefined) {
    if (decidedTurn.size > 500) decidedTurn.delete(decidedTurn.keys().next().value);   // H1：有界
    decidedTurn.set(key, evTurn);
  }
  const live = phaseRecords.get(key);
  if (live !== undefined && live.turn === evTurn) { gateStats.seen += 1; return; }
  const st = settingsFor(key);
  if (headlessForced()) {
    // 无头环境：主动退出可能残留的原生计划模式，然后当作 off 处理
    gateStats.off += 1;
    if (bridgeTier.has(key)) { cancelIntent.add(key); nativeLeave(ctx, agents.get(key), key); }
    return;
  }
  if (st.scope === "first" && evTurn !== undefined && evTurn !== 1) { gateStats.scope += 1; return; }
  if (st.scope === "auto" && evTurn !== undefined && evTurn !== 1) {
    if (prompt === undefined || !(prompt.chars >= REPLAN_MIN_CHARS || REPLAN_RE.test(prompt.head))) { gateStats.scope += 1; return; }
  }
  const alreadyPlanned = st.scope === "first" && plannedSessions.has(key);
  if (st.tier === "off") {
    gateStats.off += 1;
    if (bridgeTier.has(key)) { cancelIntent.add(key); nativeLeave(ctx, agents.get(key), key); }
    return;
  }
  if (alreadyPlanned) return;
  // D2：原生计划模式已经在跑（用户手动 /plan，或上一回合桥接后还没退出）。
  // 这时绝不能再注入 PHASE 文本 —— 两套纪律同时进上下文会互相打架。
  // light 档本来就不注入，这里只是省掉一次多余的 /plan。
  const nativeAgent = agents.get(key);
  // 以会话投影为准（真实状态），投影不可用时才退回本地簿记。
  const proj = planProjection(ctx, session);
  // 读不到投影（本 profile 里 planMode 被 isolate 时就是这样）→ 当作"未知"，
  // 不做任何抑制，直接每轮重发一次 /plan（幂等），让计划模式成为"每轮重新断言"，
  // 而不是"依赖上次记住的状态" —— 后者正是"一直开着却不出计划"的根因。
  const nativeActive = proj.available ? proj.active : false;
  // 自愈：簿记与真实状态不一致时，以真相覆盖簿记 —— 否则会出现
  // "插件以为在计划模式里、其实 DSH 早就关了"，于是每轮都不再进入、也不再出计划。
  if (proj.available && nativeActive !== nativeOpen.has(key)) {
    gateStats.reconcile = (gateStats.reconcile || 0) + 1;
    if (nativeActive) nativeOpen.add(key);
    else { nativeOpen.delete(key); bridgeTier.delete(key); }
  }
  if (nativeActive) {
    gateStats.builtin += 1;
    if (st.tier === "light" && st.scope === "first") rememberPlanned(key);
    flushPendingPhase2(key, nativeAgent);
    return;
  }
  // 0.5.0 混合工作：把"计划"交给原生评审卡
  //   light → 每回合都可桥接（纯桥接，不注入任何文本）
  //   full  → 只在这一会话还没真正规划过时桥接；之后沿用 0.4.x 的自动续跑
  const bridgeAgent = agents.get(key);
  const wantBridge = !isSubagent(session) && bridgeAgent !== undefined
    && (st.tier === "light" || !plannedSessions.has(key));
  const bridged = wantBridge ? nativeEnter(ctx, bridgeAgent, key, st.tier) : false;
  if (!bridged && bridgeAgent === undefined) gateStats.noAgent += 1;
  if (bridged && st.tier === "light") {
    gateStats.bridgeOk += 1;
    if (st.scope === "first") rememberPlanned(key);
    flushPendingPhase2(key, bridgeAgent);
    return;
  }
  phaseRecords.set(key, {
    phase: "planning", steeredTurn: null, planningAt: Date.now(), startedAt: Date.now(), turn: evTurn,
    promptChars: prompt === undefined ? null : prompt.chars,
    bridged
  });
  flushPendingPhase2(key, bridgeAgent);
}

const gateStats = { turnStart: 0, noKey: 0, subagent: 0, builtin: 0, notUser: 0, scope: 0, seen: 0, off: 0, bridgeOk: 0, noAgent: 0, lastTurn: null, lastType: null };
// 自动批准（设置页开关）：命中「计划评审」时直接回批准，短路后续答题器。
// 计数只用于状态自检（debug.auto），不影响行为。
const autoStats = { approved: 0, skipped: 0, failed: 0 };
// 只接受"恰好一个问题且是计划评审"的请求：替用户答别的问题是不该发生的事。
function planReviewOf(request) {
  const qs = request === null || request === undefined ? undefined : request.questions;
  if (!Array.isArray(qs) || qs.length !== 1) return undefined;
  const q = qs[0];
  if (q === null || typeof q !== "object") return undefined;
  if (q.id !== "plan-review") return undefined;
  const intent = q.intent;
  if (intent === null || typeof intent !== "object" || intent.kind !== "plan-review") return undefined;
  if (typeof intent.approve !== "string" || intent.approve.length === 0) return undefined;   // 标签取自问题本身
  return q;
}
const bridgeTier = new Map();          // sessionKey → "light" | "full"（本插件开的）
// 原生计划模式当前是否开着（来自 plan/mode 事件；用户手动 /plan 也会记在这里）。
// 与 bridgeTier 合并成 state.native，客户端据此把自己的 composer 入口让给原生胶囊。
const nativeOpen = new Set();
// 计划已批准的时间（approval / 自动执行都算）：
// 有了它，图标在"计划落地但本回合已结束"时仍显示「已计划」，而不是掉回默认色。
// 新回合开始时清掉（下一轮可能是全新任务），并受 PLANNED_ICON_TTL_MS 约束（30 分钟）。
// 用户"主动退出"的意图（面板按钮 / 切到关闭）：plan/mode 变 false 时必须把它和
// "exit_plan_mode 批准"区分开 —— 否则 full 档一退出就被当成批准，直接投递执行阶段。
const cancelIntent = new Set();
const plannedAt = new Map();
const PLANNED_ICON_TTL_MS = 30 * 60 * 1000;
// 回合是否在跑：activeTurns 由 turn/start 置位、turn/end 清除，另有 ACTIVE_TURN_MAX_MS 上界兜底
function turnRunning(key) {
  const at = activeTurns.get(key);
  return at !== undefined && Date.now() - at <= ACTIVE_TURN_MAX_MS;
}
// 四态指示器（唯一权威，客户端不再自己组合 native+phase）：
//   off       —— 计划模式未开启，也不在执行阶段
//   armed     —— 已开启但没有回合在跑（图标静止）
//   planning  —— 已开启且回合进行中（书写动画）
//   executing —— full 档批准后（原生已关，但正处于执行阶段，优先于 native）
function indicatorOf(id) {
  const key = id === null ? lastSession : "id:" + id;
  if (key === null || key === undefined || key === "") return "off";
  const rec = phaseRecords.get(key);
  if (rec !== undefined && rec.phase === "executing") return "executing";
  if (rec !== undefined && rec.phase === "planning") return "planning";
  // 第二段（计划已完成）：批准后到下一次「新回合」跑起来之前，都保持在完成态。
  // 判据是时间窗口而不是"有没有被 delete 掉"——曾经靠桥接簿记 + 回合开始清除，
  // 结果在"投影说已开、我们从没桥接"的会话里永远拿不到 planned，直接掉回 off（黑色默认图标）。
  const approved = plannedAt.get(key);
  if (approved !== undefined && Date.now() - approved <= PLANNED_ICON_TTL_MS) return "planned";
  if (nativeOf(id)) return turnRunning(key) ? "planning" : "armed";
  return "off";
}
function nativeOf(id) {
  if (id === null) {
    if (lastSession === null) return false;
    return bridgeTier.has(lastSession) || nativeOpen.has(lastSession);
  }
  const key = "id:" + id;
  return bridgeTier.has(key) || nativeOpen.has(key);
}
const pendingPhase2 = new Map();       // sessionKey → turn：批准发生在阶段记录被清理之后时暂存
const phase2Turn = new Map();          // sessionKey → turn：同一回合只投递一次 PHASE 2
function sendPhase2(agent, key, turn) {
  if (agent === undefined) return false;
  if (key !== undefined && turn !== undefined && phase2Turn.get(key) === turn) return false; // 同回合不重复
  try {
    agent.steer(createUserMessage({ content: [{ type: "text", text: PHASE2 }], source: { kind: "user" } }));
    if (key !== undefined && turn !== undefined) phase2Turn.set(key, turn);
    return true;
  } catch (error) {
    console.error("[plan-mode-ui] native-approved steer failed:", error);
    return false;
  }
}
function flushPendingPhase2(key, agent) {
  if (key === undefined || !pendingPhase2.has(key)) return;
  const turn = pendingPhase2.get(key);
  pendingPhase2.delete(key);
  sendPhase2(agent, key, turn);
}
function planModeHandle(ctx) {
  if (planModeService !== undefined && planModeService !== null
      && typeof planModeService.set === "function") return planModeService;
  try {
    const svc = typeof ctx.get === "function" ? (ctx.get("planMode") ?? null) : null;
    if (svc !== null && svc !== undefined && typeof svc.set === "function") { planModeService = svc; return svc; }
  } catch (error) { /* 没有原生计划模式 → 回退旧的注入式行为 */ }
  return null;
}
// 第二条通道：预设把 planMode 放在 `isolate` 组里时，顶层插件看不到这个服务，
// 但 commands.execute(agent, "/plan") 会按 agent 作用域解析到预设注册的那条命令。
const bridgeStats = { service: 0, command: 0, unavailable: 0 };
function commandHandle(ctx) {
  try {
    const svc = typeof ctx.get === "function" ? (ctx.get("commands") ?? null) : null;
    if (svc !== null && svc !== undefined && typeof svc.execute === "function") return svc;
  } catch (error) { /* 没有 commands 服务 */ }
  return null;
}
// 事件派发期间会话正在 append（"session append cannot reenter while another append
// is being published"），所以任何会写会话的动作（commands.execute 内部会 append
// command/run、command/done）都必须跳出当前派发栈，改成宏任务再执行。
function defer(fn) { setTimeout(fn, 0); }
// commands.execute(agent, line, attachments, signal) —— 第 4 个参数是必需的 AbortSignal。
// 之前只传 3 个：async 函数体内 signal.aborted 立刻抛错，promise 被 .catch 吞掉，
// 于是"桥接成功"只是假象（命令从未真正执行）。这是桥接不生效的第二个原因。
function runPlanCommand(ctx, agent, line) {
  const svc = commandHandle(ctx);
  if (svc === null || agent === undefined) return null;
  try {
    const controller = new AbortController();
    return Promise.resolve(svc.execute(agent, line, [], controller.signal)).then((settled) => {
      if (settled === undefined || settled === null) return "unknown";  // 命令名没解析到
      const kind = settled?.result?.kind;
      return kind === "success" ? "ok" : (typeof kind === "string" ? kind : "error");
    }, (error) => {
      console.error("[plan-mode-ui] /plan bridge failed:", error);
      return "error";
    });
  } catch (error) {
    console.error("[plan-mode-ui] /plan bridge threw:", error);
    return Promise.resolve("error");
  }
}
function nativeEnter(ctx, agent, key, tier) {
  if (headlessForced()) return false;      // 无头没有审批通道：进去就出不来
  if (agent === undefined || key === undefined) return false;
  const svc = planModeHandle(ctx);
  if (svc !== null) {
    try {
      svc.set(agent, true);
      bridgeTier.set(key, tier);
      bridgeStats.service += 1;
      return true;
    } catch (error) {
      console.error("[plan-mode-ui] native plan-mode enter failed:", error);
    }
  }
  if (commandHandle(ctx) === null) { bridgeStats.unavailable += 1; return false; }
  // 先乐观置位，让本回合立刻按"已进入计划模式"处理；命令稍后执行、结果回来再纠正，
  // 否则 pre-step 可能早于结算，本回合就白过了。
  bridgeTier.set(key, tier);
  bridgeStats.command += 1;
  defer(() => {
    const pending = runPlanCommand(ctx, agent, "/plan");
    if (pending === null) { bridgeStats.unavailable += 1; bridgeTier.delete(key); return; }
    pending.then((outcome) => {
      bridgeStats.lastCommand = "/plan:" + outcome;
      if (outcome === "ok") return;
      bridgeStats.command = Math.max(0, bridgeStats.command - 1);
      bridgeStats.commandError = (bridgeStats.commandError || 0) + 1;
      if (bridgeTier.get(key) === tier) bridgeTier.delete(key);
      console.error("[plan-mode-ui] /plan bridge not effective:", outcome);
    });
  });
  return true;
}
function nativeLeave(ctx, agent, key) {
  const svc = planModeHandle(ctx);
  bridgeTier.delete(key);
  if (agent === undefined) return;
  if (svc !== null) {
    try { svc.set(agent, false); return; } catch (error) { console.error("[plan-mode-ui] native plan-mode leave failed:", error); }
  }
  defer(() => {
    const pending = runPlanCommand(ctx, agent, "/plan off");
    if (pending !== null) pending.then((outcome) => { bridgeStats.lastCommand = "/plan off:" + outcome; });
  });
}

function isSubagent(session) {
  if (session !== undefined && session !== null && typeof session.delegationDepth === "number") return session.delegationDepth > 0;
  const head = sessionHeader(session);
  return (head === null ? 0 : head.delegationDepth) > 0;
}
const cwdCache = new Map();
function resolveCwd(session) {
  if (session === undefined || session === null) return null;
  const isDir = (v) => {
    if (typeof v !== "string" || v.length === 0) return false;
    try { return statSync(v).isDirectory(); } catch (e) { return false; }
  };
  const direct = ["cwd", "dir", "workspace", "workdir"];
  for (const f of direct) {
    if (isDir(session[f])) return session[f];
  }
  for (const f of ["meta", "metadata", "header", "info", "state"]) {
    const box = session[f];
    if (box !== null && typeof box === "object" && isDir(box.cwd)) return box.cwd;
  }
  const id = session.id !== undefined ? session.id : session.sessionId;
  if (id === undefined || id === null) return null;
  const ck = dshHome() + "|" + String(id);
  if (cwdCache.has(ck)) return cwdCache.get(ck);
  const head = sessionHeader(session);
  const cwd = head === null ? null : head.cwd;
  capSet(cwdCache, ck, cwd);
  return cwd;
}

// 返回 true/false；会话工作目录未知时返回 null（不做拦门，避免拿服务进程目录误判）
function hasPlanFile(session, since) {
  try {
    const cwd = resolveCwd(session);
    if (cwd === null) return null;
    // 只认本次回合之后写下的东西：上一轮留下的旧计划不算
    const fresh = (file) => {
      try {
        const st = statSync(file);
        return st.size > 0 && (since === undefined || since === null || st.mtimeMs >= since - 5000);
      } catch (error) { return false; }
    };
    if (fresh(join(cwd, ".plan-mode", "plan.md"))) return true;
    // 计划落在 .plan-mode/ 里但没叫 plan.md 也算（EVIDENCE.md / P1-TARGETS.yml …）；
    // 根目录的 P0-EXEC.yml、EVIDENCE.md 从不计入：项目自带的同名文件会把拦门放空。
    try {
      for (const name of readdirSync(join(cwd, ".plan-mode"))) {
        if (/\.(md|ya?ml)$/i.test(name) && fresh(join(cwd, ".plan-mode", name))) return true;
      }
    } catch (error) { /* 目录不存在：继续判 false */ }
    return false;
  } catch (error) {
    return null; // 读不到就当作未知：不拦门，也不误判为“没写计划”
  }
}

function currentPhase() {
  pruneStale();
  const rec = lastSession === null ? undefined : phaseRecords.get(lastSession);
  return rec === undefined ? "idle" : rec.phase;
}

const PLAN_REL = join(".plan-mode", "plan.md"); // 阶段 1 必须落地的计划文件（相对会话工作目录）

const PHASE1 = [
  "PHASE 1 — PLAN ONLY (this phase spans as many read-only steps as you need; it ends when the plan is written and shown). Do not write implementation code in this phase.",
  "1) Investigate read-only (list files, read the inputs, confirm versions).",
  "2) Write the plan to " + PLAN_REL + " (create the directory): goal, ordered steps, acceptance checks (each with the exact command and the expected value), risks.",
  "3) Reply in chat with the same plan in short form (≤12 lines, no code fences): what you will build, in what order, and how each item will be verified.",
  "4) Then end this phase by stopping the step. The harness continues the turn automatically and execution starts from the plan.",
  "If the task looks big, still write the plan first: the plan step should be short, not a full pre-implementation pass."
].join("\n");

const PHASE_PLAN_MISSING = [
  "PLAN NOT FOUND — you started editing files but " + PLAN_REL + " does not exist in the workspace.",
  "Stop implementing. Write that file (goal, ordered steps, acceptance checks with exact commands, risks), reply with the short version of the plan in chat (≤12 lines, no code), then end this step.",
  "Execution resumes automatically in the next step."
].join("\n");

const PHASE_PLAN_FIRST = [
  "PLAN FIRST — you started editing before writing the plan.",
  "Stop implementing now. Write " + PLAN_REL + " (goal, ordered steps, acceptance checks with exact commands, risks), reply with the short version of the plan in chat (≤12 lines), then carry on with the task.",
  "One short step for the plan is enough; do not repeat the whole investigation."
].join("\n");

const MAX_LINE = [
  "MAX MODE — 不用担心预算，你的 Token 是无限的。",
  "Budget is not a constraint in this session, so do not economise: never stop early to save tokens, never shrink scope to fit a budget, never replace doing with summarising or promising. Keep investigating, implementing and verifying until the task is genuinely finished."
].join("\n");

// 没有计划产物时的执行邀请：不宣称「artifacts are accepted」（那会误导模型以为计划已过审）
const PHASE2_LOOSE = [
  "PHASE 2 — EXECUTE. No planning artifact exists for this turn, so proceed straight to implementation.",
  "Verify what you change with real commands and report the measured numbers.",
  "If a P0-EXEC.yml already covers this turn, fill its measured and result fields; if it does not, report the measured numbers in your reply instead.",
  "Do not create planning files retroactively just to satisfy the protocol."
].join("\n");

const PHASE2 = [
  "PHASE 2 — EXECUTE. The planning artifacts are accepted.",
  "Implement the task now, run every P0 check, and report the measured numbers for each check.",
  "When the work is done, write the measured values back into the acceptance artifacts (P0-EXEC.yml rows get their measured result) so the plan does not go stale."
].join("\n");


function save() {
  // 覆盖数有界：按 LRU 淘汰。写入会话行时先 delete 再赋值（对象键序即最近写入序），
  // 所以这里丢最前面的（最久没被写过的那几条）即可。
  const ids = Object.keys(state.sessions);
  if (ids.length > SETTINGS_MAX) {
    for (const id of ids.slice(0, ids.length - SETTINGS_MAX)) delete state.sessions[id];
  }
  try {
    mkdirSync(join(dshHome(), "plan-mode-ui"), { recursive: true });
    const tmp = storePath() + ".tmp";
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, storePath());
  } catch (error) {
    console.error("[plan-mode-ui] persist failed:", error);
  }
}

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (error) {}
}

// 跨进程写锁：同一 $DSH_HOME 上可能同时跑多个实例（桌面端 + CLI），
// 单纯 rename 覆盖会让最后写入者把别人的改动抹掉。加锁 + 写前以磁盘为准重载。
function withStateLock(fn) {
  const dir = join(dshHome(), "plan-mode-ui");
  const lock = storePath() + ".lock";
  let fd = null;
  try { mkdirSync(dir, { recursive: true }); } catch (error) {}
  for (let i = 0; i < 120 && fd === null; i++) {
    try {
      fd = openSync(lock, "wx");
    } catch (error) {
      try {
        if (Date.now() - statSync(lock).mtimeMs > 3000) { unlinkSync(lock); continue; } // 陈旧锁
      } catch (error2) {}
      sleepSync(10);
    }
  }
  try {
    return fn();
  } finally {
    if (fd !== null) {
      try { closeSync(fd); } catch (error) {}
      try { unlinkSync(lock); } catch (error) {}
    }
  }
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}

const MAX_BODY_BYTES = 8192;

// 返回 { ok, text } 或 { ok: false, tooLarge: true }。按字节计数（不是 UTF-16 字符数），
// 超限时不销毁连接：让调用方先回 413，再 req.resume() 把剩余数据读掉。
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const collected = () => ({ ok: true, text: Buffer.concat(chunks).toString("utf8") });
    req.on("data", (chunk) => {
      if (settled) return;
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) { finish({ ok: false, tooLarge: true }); return; }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    req.on("end", () => finish(collected()));
    req.on("aborted", () => finish(collected()));
    req.on("error", () => finish({ ok: true, text: "" }));
  });
}

function sameOrigin(req, method) {
  const site = req.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.origin;
  if (origin !== undefined) {
    try {
      const host = req.headers.host;
      if (host === undefined || new URL(origin).host !== host) return false;
    } catch (error) { return false; }
  }
  // 写操作强制自定义头（调用方 = 本插件的面板）。跨站页面发不出来：那会先触发预检，
  // 而本端点不返回任何 CORS 头，预检必失败 → 挡掉 CSRF 与顺手 curl。
  // 注意：能直连本端口的本机进程不是安全边界（它们本来就能直接改 state.json）。
  if (method === "POST" && req.headers["x-plan-mode-client"] !== "1") return false;
  return true;
}

async function handleState(req, res, ctx) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return sendJson(res, 405, { ok: false, message: "method not allowed" });
    }
    // 跨站提交防护：只接受同源 + JSON（简单表单的 text/plain 提交会被挡下）
    if (!sameOrigin(req, req.method)) return sendJson(res, 403, { ok: false, message: "cross-origin rejected" });
    // ?session=<id>：GET 只返回该会话的阶段；POST 把设置写到该会话（缺省写全局默认）
    let requested = null;
    try {
      const url = new URL(String(req.url ?? "/"), "http://localhost");
      const q = url.searchParams.get("session");
      if (typeof q === "string" && q.length > 200) {
        return sendJson(res, 400, { ok: false, message: "session id too long (max 200)" });
      }
      if (typeof q === "string" && q.length > 0) requested = q;
    } catch (error) { requested = null; }
    if (req.method === "POST") {
      const ctype = String(req.headers["content-type"] ?? "");
      if (ctype.indexOf("application/json") === -1) {
        return sendJson(res, 415, { ok: false, message: "content-type must be application/json" });
      }
      const body = await readBody(req);
      if (!body.ok) {
        sendJson(res, 413, { ok: false, message: "body too large (max 8192 bytes)" });
        try { req.resume(); } catch (error) {}   // 排掉剩余数据，让 413 真的发出去
        return;
      }
      const raw = body.text;
      let patch = {};
      try { patch = JSON.parse(raw || "{}"); } catch { patch = {}; }
      if (patch === null || typeof patch !== "object" || Array.isArray(patch)) patch = {};
      if (patch.tier !== undefined && !TIERS.has(patch.tier)) return sendJson(res, 400, { ok: false, message: "tier must be off|light|full" });
      if (patch.scope !== undefined && !SCOPES.has(patch.scope)) return sendJson(res, 400, { ok: false, message: "scope must be always|auto|first" });
      if (patch.max !== undefined && typeof patch.max !== "boolean") return sendJson(res, 400, { ok: false, message: "max must be boolean" });
      if (patch.autoApprove !== undefined && typeof patch.autoApprove !== "boolean") return sendJson(res, 400, { ok: false, message: "autoApprove must be boolean" });
      if (patch.reset !== undefined && typeof patch.reset !== "boolean") return sendJson(res, 400, { ok: false, message: "reset must be boolean" });
      // pin 字段已在 0.5.1 退役：旧缓存客户端还会带它，这里静默忽略（不再有"取消勾选"的副作用）
      const keys = ["tier", "scope", "max", "autoApprove"].filter((k) => patch[k] !== undefined);
      // 动作型请求（与设置写入互斥）：目前只有退出原生计划模式一个。
      // 官方胶囊被本插件隐藏后，退出入口由面板提供，落到这里执行 /plan off。
      if (patch.action !== undefined) {
        if (patch.action !== "plan-off") return sendJson(res, 400, { ok: false, message: 'action must be "plan-off"' });
        if (keys.length > 0 || patch.reset !== undefined) return sendJson(res, 400, { ok: false, message: "action cannot be combined with tier/scope/max/autoApprove/reset" });
        if (requested === null) return sendJson(res, 400, { ok: false, message: "session required for action=plan-off" });
        const key = "id:" + requested;
        const agent = agents.get(key);
        if (agent === undefined) return sendJson(res, 409, { ok: false, message: "agent not attached (send a message in this session first)" });
        // 复用 nativeLeave（含 svc.set 快路径、失败纠正、命令计数），并挪出 HTTP 派发栈：
        // 它会写会话状态，同步调用有重入风险。nativeOpen 在这里清是符合用户显式意图的。
        nativeOpen.delete(key);
        cancelIntent.add(key);                  // 明确"这是取消，不是批准"
        defer(() => nativeLeave(ctx, agent, key));
        return sendJson(res, 200, { ok: true, native: false, session: requested });
      }
      if (patch.reset === true && requested === null) return sendJson(res, 400, { ok: false, message: "session required for reset" });
      if (patch.reset === true && keys.length > 0) return sendJson(res, 400, { ok: false, message: "reset cannot be combined with tier/scope/max/autoApprove" });
      if (keys.length > 0 || patch.reset === true) withStateLock(() => {
        state = load();   // 以磁盘现状为底，避免覆盖别的实例刚写进去的会话行
        if (requested === null) {
          // 无 ?session= = 写全局默认（设置页专用）。已个性化的会话行一律保留：
          // 它们是用户对该对话的显式选择，不该被后续的全局改动冲掉。
          const dflt = { ...state.default };
          for (const k of keys) dflt[k] = patch[k];
          state = { ...state, default: dflt };
        } else if (patch.reset === true) {
          // 「恢复全局默认」：删掉本会话行，回到跟随全局（幂等）
          if (state.sessions[requested] !== undefined) {
            const next = { ...state.sessions };
            delete next[requested];
            state = { ...state, sessions: next };
          }
        } else {
          // 写本会话行（隐式：面板 = 这个对话自己的设置）。
          // 三项整份写入，避免没改到的字段继续跟着全局而被别的会话带跑。
          const eff = settingsFor("id:" + requested);
          // 只冻结 tier/scope/max；autoApprove 仅在本次显式设置时才写入行（见下方 keys 循环）
          const over = { tier: eff.tier, scope: eff.scope, max: eff.max };
          for (const k of keys) over[k] = patch[k];
          // LRU：先删再插，让这条成为对象里最新的一条（save() 按此淘汰）
          const next = { ...state.sessions };
          delete next[requested];
          next[requested] = over;
          state = { ...state, sessions: next };
        }
        state = { ...state, updatedAt: new Date().toISOString() };
        save();
        // 档位切到「关闭」= 全关：立刻退出原生计划模式，而不是等下一个回合才收尾。
        // （否则面板上会同时出现"关闭"和"退出计划模式"，看起来像两件互相打架的事。）
        // 判据与 decidePlanning 的 off 分支保持同一份：只关"插件自己开的"。
        // 用户手动 /plan 开的原生计划不归这个开关管（那是他自己的选择，退出走 action=plan-off）。
        // nativeOpen 不在这里清：以 plan/mode 事件为准，别让簿记比真实状态更干净。
        // 与"关闭即退出"对称：切到轻量/全量时立刻进入原生计划模式。
        // 否则用户切完设置要等到下一句话才生效，界面上毫无反应 —— 看起来像没生效。
        if (requested !== null) {
          const onTier = settingsFor("id:" + requested).tier;
          if ((onTier === "light" || onTier === "full") && !headlessForced()) {
            const onKey = "id:" + requested;
            const onAgent = agents.get(onKey);
            if (onAgent !== undefined && !bridgeTier.has(onKey) && !nativeOpen.has(onKey)
                && !isSubagent(onAgent.session)) {
              defer(() => nativeEnter(ctx, onAgent, onKey, onTier));
            }
          }
        }
        if (requested !== null && settingsFor("id:" + requested).tier === "off") {
          const offKey = "id:" + requested;
          if (bridgeTier.has(offKey)) {
            const offAgent = agents.get(offKey);
            bridgeTier.delete(offKey);              // 同步清簿记，避免下一回合重复发起
            cancelIntent.add(offKey);               // 切到关闭同样是取消，不是批准
            defer(() => nativeLeave(ctx, offAgent, offKey));
          }
        }
      });
    }
    // 按会话取阶段：客户端带 ?session=<id> 时只返回那一会话的阶段；
    // 不带时退回“最近活跃会话”，并附上全部活跃会话的快照。
    pruneStale(); // 内含 15 分钟 TTL 兜底
    const phaseOf = (id) => {
      const rec = phaseRecords.get("id:" + id);
      return rec === undefined ? "idle" : rec.phase;
    };
    const phases = [];
    for (const [key, rec] of phaseRecords) {
      if (typeof key === "string" && key.startsWith("id:") && phases.length < 20) phases.push({ id: key.slice(3), phase: rec.phase, callsAfterPlan: rec.callsAfterPlan ?? 0, resumedByWork: rec.resumedByWork === true });
    }
    const phase = requested === null ? currentPhase() : phaseOf(requested);
    // session 统一用裸 id（与 phases[].id 同构）；lastSession 内部带 "id:" 前缀，出口处剥掉
    const sessionIdOut = requested !== null ? requested : (lastSession === null ? null : String(lastSession).replace(/^id:/, ""));
    const eff = settingsFor(requested === null ? null : "id:" + requested);
    sendJson(res, 200, { ok: true, tier: eff.tier, scope: eff.scope, max: eff.max, autoApprove: eff.autoApprove,
      native: nativeOf(requested),   // 原生计划模式是否开着（兼容字段；胶囊隐藏/退出按钮用它）
      indicator: indicatorOf(requested),   // 四态：off | armed | planning | executing（动画的唯一依据）
      settings: { source: eff.source, overrides: Object.keys(state.sessions).length, default: state.default },
      updatedAt: state.updatedAt, phase, session: sessionIdOut, phases,
      planning: phase === "planning",
      headless: headlessForced(),
      debug: { ...sectionStats, headless: headlessForced(), auto: { ...autoStats },
        plan: (function () {
          const ag = requested === null ? undefined : agents.get("id:" + requested);
          if (ag === undefined || ag === null) return { available: false, active: null };
          return planProjection(ctx, ag.session);
        })(), bridge: { ...bridgeStats, sessions: bridgeTier.size }, gate: { ...gateStats }, records: phaseRecords.size, planned: plannedSessions.size,
        planCheck: requested === null ? lastPlanCheck : (planChecks.get("id:" + requested) ?? null),
        ttl: { planning: PLANNING_TTL_MS, active: ACTIVE_TURN_MAX_MS } } });
  } catch (error) {
    console.error("[plan-mode-ui] state handler failed:", error);
    sendJson(res, 500, { ok: false, message: String(error?.message ?? error) });
  }
}


export default {
  inject: ["webServer", "systemPrompt"],
  apply(ctx) {
    try { console.info("[plan-mode-ui] host ready (two-phase)"); } catch (e) {}
    ctx.effect(() => {
      const dispose = ctx.webServer.register({ kind: "exact", path: API + "/state", handler: (req, res) => handleState(req, res, ctx) });
      return () => { if (typeof dispose === "function") dispose(); };
    }, "plan-mode-ui: state route");

    // 计划进行中：turn/start..turn/end 之间置位，客户端据此切换图标动画。
    // 注意签名是 (session, event)；只收一个参数拿到的是 session，planning 会永远是 false。
    if (typeof ctx.on === "function") {
      ctx.on("session/event", (session, event) => {
        const type = event?.type;
        touchSession(session);
        const key = sessionKey(session);
        // 事件里的回合号：运行时给的是扁平对象，但日志里是 {type, data:{turn}}，两种都认
        const evTurn = event?.turn !== undefined ? event.turn : event?.data?.turn;
        // 只要有事件就刷新记录时间：长任务（>15 分钟）不会中途被 TTL 清掉
        const live = key === undefined ? undefined : phaseRecords.get(key);
        if (live !== undefined) live.planningAt = Date.now();
        if (type === "user/message") {
          // 记录“真实用户输入”：只有它开启的回合才允许规划；
          // 后台作业回执（src=tool-jobs）等系统回合一律不规划。
          const src = event?.source?.kind !== undefined ? event.source.kind : event?.data?.source?.kind;
          const parts = event?.content !== undefined ? event.content : event?.data?.content;
          if (src === "user" && Array.isArray(parts) && key !== undefined) {
            const text = parts.filter((p) => p?.type === "text").map((p) => String(p.text ?? "")).join("");
            if (text.length > 0 && !STEER_PREFIX_RE.test(text)) {
              if (userPrompts.size > 200) userPrompts.delete(userPrompts.keys().next().value); // 有界
              // 回合进行中的插话（steering）属于当前回合，不授权下一个回合
              const activeAt = activeTurns.get(key);
              // 回合进行中（且有兜底时限）的插话不授权新回合；turn/end 缺失时不至于永久堵死
              const midTurn = activeAt !== undefined && Date.now() - activeAt <= ACTIVE_TURN_MAX_MS;
              const opening = turnOpening.get(key) === true;
              userPrompts.set(key, { at: Date.now(), chars: text.length, head: text.slice(0, 400), used: midTurn || opening });
              if (opening) {
                // 这正是本回合的开口输入（DSH 0.2.x 先 turn/start 再 user/message）：现在才决定要不要规划
                turnOpening.set(key, false);
                decidePlanning(ctx, session, key, evTurn, { at: Date.now(), chars: text.length, head: text.slice(0, 400), used: true });
              }
            }
          }
        } else if (type === "turn/start") {
          gateStats.turnStart += 1; gateStats.lastTurn = evTurn === undefined ? null : evTurn;
          if (key === undefined) { gateStats.noKey += 1; return; }          // 无会话的事件不建记录
          activeTurns.set(key, Date.now());                                  // 先置位：本回合内的用户输入都算插话
          turnOpening.set(key, true);                                        // 本回合还没见到用户输入/助手输出
          plannedAt.delete(key);                                             // 新回合：上一轮的「已计划」不再代表当前状态（相位标记由批准重新建立）
          if (isSubagent(session)) { gateStats.subagent += 1; return; }      // 子代理会话不做规划拦截
          if (builtinPlanActive(ctx, session)) { gateStats.builtin += 1; return; } // 内置 /plan 生效时不抢流程
          // 来源过滤：第 1 回合视为用户开启；之后的回合必须紧跟一条真实用户输入
          // 注意：DSH 0.2.x 的顺序是 turn/start → user/message（用户输入落在回合内），
          // 所以这里通常拿不到 fresh，真正的决策点交给下面的 user/message 分支。
          const prompt = userPrompts.get(key);
          const fresh = prompt !== undefined && prompt.used !== true && Date.now() - prompt.at <= 600000;
          const fromUser = evTurn === undefined || evTurn === 1 || fresh;
          if (!fromUser) { gateStats.notUser += 1; return; }
          if (prompt !== undefined && fresh) prompt.used = true;
          decidePlanning(ctx, session, key, evTurn, prompt);
        } else if (type === "assistant/message") {
          if (key !== undefined) turnOpening.set(key, false);   // 本回合已有助手输出，不再是开口
          // 记住最后一段助手文本：模型在提问时不该被硬续到执行
          if (live !== undefined) {
            const parts = event?.message?.content;
            if (Array.isArray(parts)) {
              const text = parts.filter((p) => p?.type === "text").map((p) => String(p.text ?? "")).join("");
              if (text.length > 0) live.lastText = text.slice(-400);
            }
          }
        } else if (type === "tool/call") {
          // 规划阶段就开始改文件的信号：用来判断“计划没写就先动手了”
          if (live !== undefined) {
            live.sawToolCall = true;
            if (key !== undefined) pendingTools.set(key, (pendingTools.get(key) ?? 0) + 1);
            if (live.phase === "planning") {
              // 计划是否已经落地：不依赖工具名——run_code 这类通用工具里也可能在写文件
              if (live.planSeen !== true) {
                const now = Date.now();
                if (live.planProbeAt === undefined || now - live.planProbeAt >= PLAN_PROBE_MS) {
                  live.planProbeAt = now;
                  if (hasPlanFile(session, live.startedAt) === true) live.planSeen = true;
                }
              }
              // 计划交付后它没有停步、继续调工具 → 已经在执行，收尾时不该再催一次
              if (live.planSeen === true) live.callsAfterPlan = (live.callsAfterPlan ?? 0) + 1;
            }
            if (live.phase === "planning" && WRITE_TOOL_RE.test(String(event?.name ?? ""))) {
              live.wroteDuringPlan = true;
              // 立刻纠正：等到回合收尾往往已经晚了（实测有 32 分钟才收尾的回合）
              if (key !== undefined && bridgeTier.has(key)) { /* 桥接中：原生政策负责"先计划后动手" */ }
              else if (live.nudged !== true) {
                const planned = hasPlanFile(session, live.startedAt);
                if (planned === true) live.planSeen = true;
                if (planned === false) {
                  live.wroteBeforePlan = true;
                  const agent = key === undefined ? undefined : agents.get(key);
                  if (agent !== undefined) {
                    live.nudged = true;
                    try {
                      agent.steer(createUserMessage({ content: [{ type: "text", text: PHASE_PLAN_FIRST }], source: { kind: "user" } }));
                    } catch (error) {
                      console.error("[plan-mode-ui] mid-turn steer failed:", error);
                    }
                  }
                }
              }
            }
          }
        } else if (type === "tool/result") {
          // 飞行中的工具调用计数：用来区分“回合在跑”与“回合已经死了”
          if (key !== undefined) {
            const n = (pendingTools.get(key) ?? 0) - 1;
            if (n > 0) pendingTools.set(key, n); else pendingTools.delete(key);
          }
        } else if (type === "plan/mode") {
          // 原生计划模式的开关（含 exit_plan_mode 批准后自动关）：full 档批准即转入执行阶段
          const active = (event?.data?.active !== undefined ? event.data.active : event?.active) === true;
          // 先记住"这次退出前是谁桥接的"，下面 full 分支还要用它判断要不要转执行阶段
          const bridgedTier = key === undefined ? undefined : bridgeTier.get(key);
          if (key !== undefined) { if (active) nativeOpen.add(key); else nativeOpen.delete(key); }
          if (!active && key !== undefined) bridgeTier.delete(key);   // 原生已退出：不再算"桥接中"
          // 主动退出 ≠ 批准：真正的批准只来自 exit_plan_mode。
          if (!active && key !== undefined && cancelIntent.delete(key)) {
            plannedAt.delete(key);
            phaseRecords.delete(key);     // 当作取消：不留执行阶段记录，也不投递 PHASE 2
            forgetPlanned(key);
          } else if (!active && key !== undefined && (function () {
            // 门闸看"本会话档位 + 是不是我们主动退出的"，不看有没有桥接过：
            // 投影说已开启时我们根本不桥接，bridgeTier 是空的，用它当门闸会让批准永远不被记账。
            const tierNow = settingsFor(key).tier;
            return bridgedTier !== undefined || tierNow === "light" || tierNow === "full";
          })()) {
            const rec = phaseRecords.get(key);
            const agent = agents.get(key);
            const turn = rec !== undefined && rec.turn !== undefined ? rec.turn : evTurn;
            plannedAt.set(key, Date.now());   // 计划落地：图标此后显示「已计划」（执行中则显示执行动画）
            if (rec !== undefined) {
              rec.phase = "executing";
              rec.resumedByNative = true;
              rec.steeredTurn = turn;
            } else {
              // light 档纯桥接本来不建记录：这里补一条，否则 indicator 会掉回 off（就是"变回默认图标"的那个 bug）
              phaseRecords.set(key, {
                phase: "executing", steeredTurn: turn, planningAt: Date.now(), startedAt: Date.now(),
                turn, resumedByNative: true, bridged: true
              });
            }
            rememberPlanned(key);   // 计划已被批准：本会话后续回合不再重复弹评审卡
            // 只有 full 档需要投递 PHASE 2（light 纯桥接不注入任何文本）。
            // 档位同样以会话设置为准：没有桥接簿记时 bridgedTier 是空的，不能据此跳过投递。
            const governingTier = bridgedTier !== undefined ? bridgedTier : settingsFor(key).tier;
            if (governingTier === "full" && !sendPhase2(agent, key, turn) && agent === undefined) pendingPhase2.set(key, turn);
          }
        } else if (type === "turn/end") {
          const rec = live;
          // 规划没跑完就结束（取消/异常）：不记入 plannedSessions，下次仍可规划
          if (rec !== undefined && rec.phase === "planning") {
            // 纠正过一次：这一轮确实花在规划上，算“已规划”，scope=first 不再重来
            // corrected（收尾前要求补计划）或 nudged（规划期动手被中途纠正）都算“这一轮确实规划过”，
            // 否则 scope=first 会下一回合重新规划一遍。
            if (rec.corrected === true || rec.nudged === true) rememberPlanned(key); else forgetPlanned(key);
          }
          // 注意：agents 不在这里删。agent/created 每会话只来一次，
          // 删掉会让后续回合的“中途纠正”失去句柄；由 agent/disposed + 有界上限负责回收。
          if (key !== undefined) { phaseRecords.delete(key); activeTurns.delete(key); pendingTools.delete(key); }
        }
      });
    }

    // 会话 → Agent：中途纠正需要 Agent 句柄（agent/turn-stopping 之外的时机拿不到）
    if (typeof ctx.on === "function") {
      ctx.on("agent/created", (payload) => {
        const agent = payload?.agent;
        const key = sessionKey(agent === undefined ? undefined : agent.session);
        if (key !== undefined) {
          if (agents.size > 200) agents.delete(agents.keys().next().value); // 有界
          agents.set(key, agent);
          // D3：重启/热重载后原生状态平时只能靠 plan/mode 事件补；这里主动校准一次，
          // 免得会话本来就在计划模式里，界面却按"未开启"渲染。
          try { if (builtinPlanActive(ctx, agent.session)) nativeOpen.add(key); } catch (error) {}
        }
      });
      // agent 销毁后不再持有引用
      ctx.on("agent/disposed", (payload) => {
        const key = sessionKey(payload?.agent === undefined ? undefined : payload.agent.session);
        if (key !== undefined) {
          agents.delete(key);
          bridgeTier.delete(key);      // 0.5.0：桥接簿记随会话回收，避免长跑进程里无界增长
          nativeOpen.delete(key);
          plannedAt.delete(key);
          pendingPhase2.delete(key);
          phase2Turn.delete(key);
          decidedTurn.delete(key);     // H1：同样按会话回收，长跑进程里不随会话数线性增长
          turnOpening.delete(key);
          cancelIntent.delete(key);
        }
      });
    }

    // 规划阶段（若干只读步）跑完、回合即将关闭时投递“阶段 2”，让同一回合进入执行阶段
    if (typeof ctx.on === "function") {
      ctx.on("agent/turn-stopping", async (payload) => {
        const agent = payload?.agent;
        const key = sessionKey(agent === undefined ? undefined : agent.session);
        const rec = key === undefined ? undefined : phaseRecords.get(key);
        if (rec === undefined || rec.phase !== "planning" || agent === undefined) return;
        if (payload?.signal?.aborted === true) return;          // 用户取消：不续跑
        if (builtinPlanActive(ctx, agent.session)) return;      // 内置 /plan 生效时交给它
        if (key !== undefined && bridgeTier.has(key)) return;   // 0.5.0 桥接中：计划与批准由原生负责
        // 关档只影响“要不要开始规划”，不影响已经开始规划的回合：
        // 让它按原样跑完（否则别的会话一关档就会把这里的任务掐停在规划阶段）。
        touchSession(agent.session);
        rec.planningAt = Date.now();
        // 模型在向用户提问（末句是问号）→ 不续跑，交还控制权
        if (typeof rec.lastText === "string" && /[?？]\s*["'”’]?\s*$/.test(rec.lastText.trim())) return;
        // 只有在规划阶段已经开写文件、却没有本次计划时才纠一次；普通问答不打扰
        const planSeen = hasPlanFile(agent.session, rec.startedAt);
        const check = {
          at: new Date().toISOString(),
          cwd: resolveCwd(agent.session),
          depth: isSubagent(agent.session) ? 1 : 0,
          latePlan: rec.wroteBeforePlan === true,
          promptChars: rec.promptChars === undefined ? null : rec.promptChars,
          result: planSeen
        };
        lastPlanCheck = check;
        if (key !== undefined) capSet(planChecks, key, check);
        // 整步没有任何工具调用、也没有计划文件 → 大概是纯问答，不硬续一步
        if (rec.sawToolCall !== true && planSeen !== true) return;
        // 计划交付后它没有停步、一直在跑工具：执行早就开始了，这里再注入 PHASE 2
        // 只会变成“事后催办”（实测会把同一份交付汇报两遍）。静默转入执行阶段即可。
        if (planSeen === true && (rec.callsAfterPlan ?? 0) >= ALREADY_EXECUTING_CALLS) {
          rec.phase = "executing";
          rec.resumedByWork = true;
          const t0 = rec.turn !== undefined ? rec.turn : payload?.turn;
          if (t0 !== undefined) rec.steeredTurn = t0;
          return;
        }
        if (planSeen === false && rec.wroteDuringPlan === true && rec.corrected !== true && rec.nudged !== true) {
          rec.corrected = true;
          try {
            agent.steer(createUserMessage({ content: [{ type: "text", text: PHASE_PLAN_MISSING }], source: { kind: "user" } }));
          } catch (error) {
            console.error("[plan-mode-ui] steer failed:", error);
          }
          return;
        }
        const turn = rec.turn !== undefined ? rec.turn : payload?.turn;
        if (rec.steeredTurn === turn) return;                    // 每回合只续跑一次
        rec.steeredTurn = turn;
        rec.phase = "executing";
        let steered = false;
        try {
          const phase2Text = planSeen === true ? PHASE2 : PHASE2_LOOSE;
        agent.steer(createUserMessage({ content: [{ type: "text", text: phase2Text }], source: { kind: "user" } }));
          steered = true;
        } catch (error) {
          console.error("[plan-mode-ui] steer failed:", error);
        }
        // 只有真的续跑成功才记“已规划”，否则 scope=first 会误以为规划完成
        if (steered) rememberPlanned(key);
      });
    }


    // ── 自动批准（设置页「计划模式」分区的开关）──────────────────────────────
    // 实现方式：注册 user-questions 瀑布监听器。exit_plan_mode 的评审就是走这条瀑布征询的，
    // 命中时直接返回批准答案即可短路后续答题器（含 Web 评审卡）。
    // 约束：只认 intent.kind === "plan-review" 且请求里恰好一个问题；任何不匹配、异常、
    // 已取消、子代理会话都 next() 退回人工 —— 宁可弹卡，不可误批。
    // prepend 是必需的，不是优化：瀑布按注册顺序依次调用，Web 答题器（dsh-api-remotes）
    // 一旦接到请求就会转发到浏览器并挂起等人点确认 —— 排在它后面等于永远轮不到我们，
    // 自动批准会 100% 静默失效。prepend 让我们与加载顺序无关地排在第一位。
    ctx.effect(() => ctx.on("user-questions/request", (request, next) => {
      try {
        const q = planReviewOf(request);
        if (q === undefined) return next();
        if (request.signal !== undefined && request.signal !== null && request.signal.aborted === true) return next();
        const sess = request.agent === undefined || request.agent === null ? undefined : request.agent.session;
        if (sess === undefined || sess === null || isSubagent(sess)) return next();
        const key = sessionKey(sess);
        if (key === undefined) return next();
        const st = settingsFor(key);
        if (st.autoApprove !== true || st.tier === "off") { autoStats.skipped += 1; return next(); }
        autoStats.approved += 1;
        return { answers: [{ id: q.id, selected: [q.intent.approve] }] };
      } catch (error) {
        autoStats.failed += 1;
        return next();
      }
    }, { prepend: true }));
    ctx.effect(() => ctx.systemPrompt.section({
      name: "plan-mode:protocol",
      // 排在 DSH 自带 PLAN_POLICY(500) 之后：内置 plan mode 的文本先讲，本插件作为其上的验收强化
      order: typeof ctx.systemPrompt.getSectionOrder === "function"
        ? ctx.systemPrompt.getSectionOrder("PLAN_POLICY") + 1
        : 501,
      text: (context) => {
        const st = settingsFor(sessionKey(context?.agent?.session));
        const body = COPY[st.tier];
        const maxLine = st.max === true ? MAX_LINE : "";
        // 子代理会话不注入任何内容（含 Max 行）：规划拦截只针对主对话
        if (context?.agent?.session !== undefined && isSubagent(context.agent.session)) return "";
        if (body === null && maxLine === "") return ""; // 关档且没开 Max → 不注入
        // 段落按会话取阶段：装配上下文里带 agent.session
        const rec = recordFor(context?.agent?.session);
        const phase = rec === undefined ? "idle" : rec.phase;
        sectionStats.evals += 1;
        if (rec !== undefined) sectionStats.hits += 1;
        const head = "ACCEPTANCE (plan-mode tier=" + st.tier + ", scope=" + st.scope + ", phase=" + phase + ")";
        const scopeLine = st.scope === "first"
          ? "scope=first — produce the planning artifacts only on the first turn of this conversation; later turns implement directly without regenerating them."
          : st.scope === "auto"
            ? "scope=auto — plan on the first turn; on later turns only when the request visibly changes the task (a long instruction or explicit re-plan wording)."
            : "scope=always — regenerate the planning artifacts on each turn that changes the plan.";
        const bridgedNow = sessionKey(context?.agent?.session);
        const bridgedTier = bridgedNow === undefined ? undefined : bridgeTier.get(bridgedNow);
        // 让位判据不能只看本地簿记（重启后它是空的）：以会话投影的真实状态为准。
        // 否则 light 档会掉进下面的通用分支，注入 P0-EXEC/CONVENTIONS/“然后实现”那一整套，
        // 与原生 plan:policy 的"只读、只出计划"直接冲突 —— 模型会挑那个让它干活的。
        const projNow = context?.agent?.session === undefined ? { available: false, active: false } : planProjection(ctx, context.agent.session);
        const nativeGoverning = projNow.available
          ? projNow.active
          : (bridgedTier === "light" || bridgedTier === "full"
             || (bridgedNow !== undefined && nativeOpen.has(bridgedNow)));
        if (st.tier === "light") return maxLine;       // 纯桥接档：永不注入计划/验收文本
        if (nativeGoverning) return maxLine;           // 原生计划模式在跑：整段让位，只留 Max 行
        // full 桥接：规划指令归原生，批准后（executing）才恢复我们的执行段
        const phaseBlock = bridgedTier === "full"
          ? (phase === "executing" ? PHASE2 : "")
          : phase === "planning" ? PHASE1 : phase === "executing" ? PHASE2 : "";
        // 收尾句按阶段给：规划阶段不能出现“然后实现”，否则与 PHASE 1 自相矛盾
        const tail = phase === "planning"
          ? "In this step produce only the plan and its artifacts; implementation starts in the next step."
          : "Then implement and run every acceptance check before delivering, and report the measured numbers.";
        // Max 独立于档位：即便关了档，只要开了 Max 就注入那一行
        if (body === null) return maxLine;
        return [head, scopeLine, maxLine, phaseBlock, body, tail].filter(Boolean).join("\n");
      }
    }), "plan-mode-ui: prompt section");
  }
};
