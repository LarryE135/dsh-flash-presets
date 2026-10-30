// 接管官方胶囊：隐藏 [data-slot=conversation.input.plan]，本插件动画按状态驱动；
// 退出原生计划模式改由面板提供（POST {action:"plan-off"} → /plan off）。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";

const HERE = dirname(fileURLToPath(import.meta.url));
let seq = 0;

async function boot(tier, withCommands) {
  const home = mkdtempSync(join(tmpdir(), "pmui-takeover-"));
  mkdirSync(join(home, "plan-mode-ui"), { recursive: true });
  writeFileSync(join(home, "plan-mode-ui", "state.json"), JSON.stringify({ version: 1, default: { tier, scope: "always", max: false }, sessions: {} }));
  process.env.DSH_HOME = home;
  const handlers = new Map();
  const seen = [];
  let route = null;
  const commands = withCommands ? {
    execute(agent, line, attachments, signal) {
      if (signal === undefined) throw new TypeError("signal is required");
      seen.push(line);
      return Promise.resolve({ commandId: "c", result: { kind: "success" } });
    }
  } : null;
  const { default: plugin } = await import("../lib/index.js?takeover" + (++seq) + "-" + Date.now());
  const ctx = {
    get: (n) => (n === "commands" ? commands : undefined),
    on: (n, fn) => handlers.set(n, fn),
    inject: () => {},
    effect: (fn) => { try { fn(); } catch (e) {} },
    webServer: { register: (spec) => { route = spec.handler; return () => {}; } },
    systemPrompt: { section: () => {}, getSectionOrder: () => 500 },
    logger: { warn() {}, info() {} }
  };
  plugin.apply(ctx);
  const session = { id: "takeover-" + seq, delegationDepth: 0 };
  handlers.get("agent/created")?.({ agent: { session, steer() {}, inject() {} } });
  const call = (sid, method, body) => new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = "/api/plan-mode/state" + (sid === null ? "" : "?session=" + encodeURIComponent(sid));
    req.headers = { host: "127.0.0.1:3081", "content-type": "application/json", "x-plan-mode-client": "1" };
    const res = { writeHead() {}, end(text) { resolve(JSON.parse(text)); } };
    route(req, res);
    if (method === "POST") {
      req.emit("data", Buffer.from(JSON.stringify(body || {})));
      req.emit("end");
    }
  });
  return { fire: (n, ...a) => handlers.get(n)?.(...a), session, seen, get: (sid) => call(sid, "GET"), post: (sid, body) => call(sid, "POST", body) };
}

const userMsg = (turn) => ({ type: "user/message", data: { turn, content: [{ type: "text", text: "继续" }], source: { kind: "user" } } });
const bridged = async (c) => {
  c.fire("session/event", c.session, { type: "turn/start", data: { turn: 2 } });
  c.fire("session/event", c.session, userMsg(2));
  return c.get(c.session.id);
};

// T1：light 桥接中 native=true（动画走书写态）
{
  const c = await boot("light", true);
  const d = await bridged(c);
  if (d.native !== true) throw new Error("T1 期望 native=true，实际 " + JSON.stringify(d.native));
  console.log("PASS T1 light 桥接中 native=true");
}

// T2：off 档 native=false
{
  const c = await boot("off", true);
  const d = await bridged(c);
  if (d.native !== false) throw new Error("T2 期望 native=false，实际 " + JSON.stringify(d.native));
  console.log("PASS T2 off 档 native=false");
}

// T3：full 档批准（plan/mode active=false）→ native=false 且 phase=executing
{
  const c = await boot("full", true);
  if ((await bridged(c)).native !== true) throw new Error("T3 前置失败：full 没桥接");
  c.fire("session/event", c.session, { type: "plan/mode", data: { turn: 2, active: false } });
  const d = await c.get(c.session.id);
  if (d.native !== false || d.phase !== "executing") throw new Error("T3 期望 false/executing，实际 " + d.native + "/" + d.phase);
  console.log("PASS T3 full 批准后 native=false、phase=executing");
}

// T4：面板「退出」= POST action=plan-off → 真的执行 /plan off，native 立刻为 false
{
  const c = await boot("light", true);
  if ((await bridged(c)).native !== true) throw new Error("T4 前置失败");
  const r = await c.post(c.session.id, { action: "plan-off" });
  if (r.ok !== true || r.native !== false) throw new Error("T4 响应异常：" + JSON.stringify(r));
  await new Promise((res) => setTimeout(res, 20));
  if (!c.seen.includes("/plan off")) throw new Error("T4 没有真的执行 /plan off，seen=" + JSON.stringify(c.seen));
  if ((await c.get(c.session.id)).native !== false) throw new Error("T4 退出后 native 仍为 true");
  console.log("PASS T4 action=plan-off 执行 /plan off 且 native=false");
}

// T5：action 的参数校验
{
  const c = await boot("light", true);
  await bridged(c);
  if ((await c.post(null, { action: "plan-off" })).ok !== false) throw new Error("T5 缺 session 应当 400");
  if ((await c.post(c.session.id, { action: "nope" })).ok !== false) throw new Error("T5 未知 action 应当 400");
  if ((await c.post(c.session.id, { action: "plan-off", tier: "full" })).ok !== false) throw new Error("T5 action+tier 应当 400");
  console.log("PASS T5 action 参数校验（缺 session / 未知值 / 混用 tier 全部拒绝）");
}

// T6：客户端让位规则已撤、官方胶囊被隐藏、动画按 glyphPhase 驱动
{
  const src = readFileSync(join(HERE, "..", "lib", "client.js"), "utf8");
  if (src.includes(".pmo-root[data-native='true']{display:none}")) throw new Error("T6 让位规则没删掉");
  if (!src.includes("[data-slot='conversation.input.plan']{display:none!important}")) throw new Error("T6 缺少隐藏官方胶囊的 CSS");
  if (!src.includes('"data-phase": glyphPhase(s)')) throw new Error("T6 data-phase 没走 glyphPhase");
  if (!src.includes("function exitNative()")) throw new Error("T6 缺少退出动作");
  console.log("PASS T6 客户端隐藏官方胶囊并用 glyphPhase 驱动动画");
}

// T7：glyphPhase 的行为（直接调用模块工厂，不渲染）
{
  let mod = null;
  globalThis.window = { __ModuleLoader__: { load: (m) => { mod = m; } } };
  await import("../lib/client.js?glyph" + Date.now());
  const exp = mod.factory(() => ({}));
  const g = exp.__glyphPhase;
  const cases = [
    [{ native: true, phase: "idle" }, "planning"],
    [{ native: true, phase: "executing" }, "planning"],
    [{ native: false, phase: "executing" }, "executing"],
    [{ native: false, phase: "planning" }, "planning"],
    [{}, "idle"]
  ];
  for (const [input, want] of cases) {
    const got = g(input);
    if (got !== want) throw new Error("T7 glyphPhase(" + JSON.stringify(input) + ") = " + got + "，期望 " + want);
  }
  console.log("PASS T7 glyphPhase 状态映射（原生进行中→书写、执行→执行、其余→idle）");
}
