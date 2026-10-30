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

const SETTINGS_MAX = 50;                  // 每会话覆盖条数上限
const pickTier = (v) => (TIERS.has(v) ? v : undefined);
const pickScope = (v) => (SCOPES.has(v) ? v : undefined);
// 设置分两层：default（全局默认）+ sessions（按会话覆盖）。
// 旧格式 { tier, scope } 自动迁移成 default，会话覆盖为空。
function load() {
  const fallback = { default: { tier: "light", scope: "always", max: false }, sessions: {}, updatedAt: null };
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
        const pinned = v.pinned === true;
        if (tier === undefined && scope === undefined && max === undefined && !pinned) continue;
        sessions[id] = {
          ...(tier === undefined ? {} : { tier }),
          ...(scope === undefined ? {} : { scope }),
          ...(max === undefined ? {} : { max }),
          ...(pinned ? { pinned: true } : {})
        };
      }
    }
    const dflt = { tier: pickTier(dfltRaw.tier) ?? "light", scope: pickScope(dfltRaw.scope) ?? "always", max: dfltRaw.max === true };
    // 钉住的行必须整份冻结：早期版本只记用户动过的那几个字段，其余跟着默认走，
    // 结果就是“勾着仅本会话，别的会话一改全局照样被覆盖”。缺项按当前默认补齐。
    for (const over of Object.values(sessions)) {
      if (over.pinned !== true) continue;
      if (over.tier === undefined) over.tier = dflt.tier;
      if (over.scope === undefined) over.scope = dflt.scope;
      if (over.max === undefined) over.max = dflt.max;
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
function builtinPlanActive(ctx, session) {
  try {
    if (planModeService === undefined || planModeService === null) { // 服务可能稍后才注册
      planModeService = typeof ctx.get === "function" ? (ctx.get("planMode") ?? null) : null;
    }
    if (planModeService !== null && typeof planModeService.loggedActive === "function") {
      return planModeService.loggedActive(session) === true;
    }
  } catch (error) { planModeService = null; }
  return false;
}

// ── 原生计划模式桥接（0.5.0 混合工作）──────────────────────────────────────
// light：纯桥接 —— 不注入任何 PHASE 文本，DSH 自带 plan mode 全权接管
//        （政策段 / /plan off / exit_plan_mode / 对话框上方的计划评审卡）。
// full ：桥接 + 我们的执行层 —— 计划同样走原生评审卡，批准（plan/mode -> false）
//        之后再投递 PHASE 2，执行纪律仍由本插件提供。
const bridgeTier = new Map();          // sessionKey → "light" | "full"（本插件开的）
function planModeHandle(ctx) {
  if (planModeService !== undefined && planModeService !== null
      && typeof planModeService.set === "function") return planModeService;
  try {
    const svc = typeof ctx.get === "function" ? (ctx.get("planMode") ?? null) : null;
    if (svc !== null && svc !== undefined && typeof svc.set === "function") { planModeService = svc; return svc; }
  } catch (error) { /* 没有原生计划模式 → 回退旧的注入式行为 */ }
  return null;
}
function nativeEnter(ctx, agent, key, tier) {
  const svc = planModeHandle(ctx);
  if (svc === null || agent === undefined || key === undefined) return false;
  try {
    svc.set(agent, true);
    bridgeTier.set(key, tier);
    return true;
  } catch (error) {
    console.error("[plan-mode-ui] native plan-mode enter failed:", error);
    return false;
  }
}
function nativeLeave(ctx, agent, key) {
  const svc = planModeHandle(ctx);
  bridgeTier.delete(key);
  if (svc === null || agent === undefined) return;
  try { svc.set(agent, false); } catch (error) { console.error("[plan-mode-ui] native plan-mode leave failed:", error); }
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
  // 覆盖数有界：先丢最早的非钉住行；钉住行（“仅本会话”）最后才丢，
  // 否则会话一多，用户显式钉住的那行会被别的会话悄悄挤掉。
  const ids = Object.keys(state.sessions);
  if (ids.length > SETTINGS_MAX) {
    const excess = ids.length - SETTINGS_MAX;
    const nonPinned = ids.filter((id) => state.sessions[id] === undefined || state.sessions[id].pinned !== true);
    const pinned = ids.filter((id) => state.sessions[id] !== undefined && state.sessions[id].pinned === true);
    const drop = nonPinned.slice(0, excess);
    for (const id of pinned.slice(0, Math.max(0, excess - drop.length))) drop.push(id);
    for (const id of drop) delete state.sessions[id];
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

async function handleState(req, res) {
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
      if (patch.pin !== undefined && typeof patch.pin !== "boolean") return sendJson(res, 400, { ok: false, message: "pin must be boolean" });
      const keys = ["tier", "scope", "max"].filter((k) => patch[k] !== undefined);
      if (keys.length > 0 || patch.pin !== undefined) withStateLock(() => {
        state = load();   // 以磁盘现状为底，避免覆盖别的实例刚写进去的会话覆盖
        if (requested === null) {
          const dflt = { ...state.default };
          for (const k of keys) dflt[k] = patch[k];
          state = { ...state, default: dflt };
          // 不变式：会话覆盖永不与默认等值。默认改到与某覆盖一致时，该覆盖失去意义，删掉，
          // 否则它会一直“钉”住旧值，之后改全局这个会话不跟随。
          const keep = {};
          for (const [id, over] of Object.entries(state.sessions)) {
            // pinned 行是用户显式勾了"仅本会话"的：默认怎么改都保留它（钉住就是钉住）
            if (over.pinned === true) { keep[id] = over; continue; }
            const et = over.tier !== undefined ? over.tier : dflt.tier;
            const es = over.scope !== undefined ? over.scope : dflt.scope;
            const em = over.max !== undefined ? over.max === true : dflt.max === true;
            if (!(et === dflt.tier && es === dflt.scope && em === dflt.max)) keep[id] = over;
          }
          state = { ...state, sessions: keep };
        } else if (patch.pin === false) {
          // 显式取消“仅本会话”：删掉本会话行，回到跟随全局默认
          if (state.sessions[requested] !== undefined) {
            const next = { ...state.sessions };
            delete next[requested];
            state = { ...state, sessions: next };
          }
          // 同一次请求里还带了三项的值 → 取消钉住后按全局改动写下去（别静默丢弃）
          if (keys.length > 0) {
            const dflt = { ...state.default };
            for (const k of keys) dflt[k] = patch[k];
            state = { ...state, default: dflt };
          }
        } else {
          // 写入本会话行并钉住：即使生效值与默认完全相同也保留这一行，
          // 面板据此显示“本会话”。旧实现按“值与默认相等就删行”，
          // 导致勾着“仅本会话”来回切档位时被误判成“全局”。
          // 钉住 = 把当时生效的三项整份写进会话行（不只是这次改动的那一项），
          // 否则没被改到的字段继续跟着全局，勾了“仅本会话”也会被别的会话带跑。
          const eff = settingsFor("id:" + requested);
          const over = { tier: eff.tier, scope: eff.scope, max: eff.max, pinned: true };
          for (const k of keys) over[k] = patch[k];
          state.sessions = { ...state.sessions, [requested]: over };
        }
        state = { ...state, updatedAt: new Date().toISOString() };
        save();
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
    sendJson(res, 200, { ok: true, tier: eff.tier, scope: eff.scope, max: eff.max,
      settings: { source: eff.source, overrides: Object.keys(state.sessions).length, default: state.default },
      updatedAt: state.updatedAt, phase, session: sessionIdOut, phases,
      planning: phase === "planning",
      debug: { ...sectionStats, records: phaseRecords.size, planned: plannedSessions.size,
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
      const dispose = ctx.webServer.register({ kind: "exact", path: API + "/state", handler: handleState });
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
              userPrompts.set(key, { at: Date.now(), chars: text.length, head: text.slice(0, 400), used: midTurn });
            }
          }
        } else if (type === "turn/start") {
          if (key === undefined) return;                                   // 无会话的事件不建记录
          activeTurns.set(key, Date.now());                                  // 先置位：本回合内的用户输入都算插话
          if (isSubagent(session)) return;                                   // 子代理会话不做规划拦截
          if (builtinPlanActive(ctx, session)) return;                        // 内置 /plan 生效时不抢流程
          // 来源过滤：第 1 回合视为用户开启；之后的回合必须紧跟一条真实用户输入
          const prompt = userPrompts.get(key);
          // 一条输入只授权一个回合：已被消费 / 太久以前的输入不算（插话也不会授权）
          const fresh = prompt !== undefined && prompt.used !== true && Date.now() - prompt.at <= 600000;
          const fromUser = evTurn === undefined || evTurn === 1 || fresh;
          if (!fromUser) return;
          // 只在真正被这条输入开启的回合里消费它（系统回合抢先开启时不消耗用户的输入）
          if (prompt !== undefined && fresh) prompt.used = true;
          const st = settingsFor(key);
          // scope=first 只认“对话的第 1 回合”：重启后从中途继续的回合（turn>1）不触发规划
          if (st.scope === "first" && evTurn !== undefined && evTurn !== 1) return;
          // scope=auto：turn>1 只在任务明显变化时重规划（长指令或改方案类措辞）
          if (st.scope === "auto" && evTurn !== undefined && evTurn !== 1) {
            if (prompt === undefined || !(prompt.chars >= REPLAN_MIN_CHARS || REPLAN_RE.test(prompt.head))) return;
          }
          const existing = live;
          if (existing !== undefined && existing.turn === evTurn) return; // 同一回合重复 turn/start 不重置阶段
          const alreadyPlanned = st.scope === "first" && plannedSessions.has(key);
          if (st.tier === "off") {
            // 关档：把我们开过的原生计划模式复位（用户手动 /plan 的不动，因为它不在 bridgeTier 里）
            if (bridgeTier.has(key)) nativeLeave(ctx, agents.get(key), key);
          } else if (!alreadyPlanned) {
            // 0.5.0 混合工作：light/full 先桥接到原生计划模式，计划交给原生评审卡
            const bridgeAgent = agents.get(key);
            const bridged = isSubagent(session) || bridgeAgent === undefined
              ? false
              : nativeEnter(ctx, bridgeAgent, key, st.tier);
            if (bridged && st.tier === "light") return;   // 纯桥接：不建阶段记录、不注入任何文本
            phaseRecords.set(key, {
              phase: "planning", steeredTurn: null, planningAt: Date.now(), startedAt: Date.now(), turn: evTurn,
              promptChars: prompt === undefined ? null : prompt.chars,   // 诊断：开启本回合的输入长度
              bridged
            });
          }
        } else if (type === "assistant/message") {
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
          if (!active && key !== undefined && bridgeTier.get(key) === "full") {
            const rec = phaseRecords.get(key);
            const agent = agents.get(key);
            if (rec !== undefined && rec.phase === "planning" && agent !== undefined) {
              rec.phase = "executing";
              rec.resumedByNative = true;
              rec.steeredTurn = rec.turn !== undefined ? rec.turn : evTurn;
              try {
                agent.steer(createUserMessage({ content: [{ type: "text", text: PHASE2 }], source: { kind: "user" } }));
              } catch (error) {
                console.error("[plan-mode-ui] native-approved steer failed:", error);
              }
            }
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
        }
      });
      // agent 销毁后不再持有引用
      ctx.on("agent/disposed", (payload) => {
        const key = sessionKey(payload?.agent === undefined ? undefined : payload.agent.session);
        if (key !== undefined) agents.delete(key);
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
        if (bridgedTier === "light") return "";   // 纯桥接：原生 plan:policy 已接管，本插件不再插话
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
