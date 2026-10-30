// 审计修复回归：D1 off 档只关"自己开的" / D2 原生已在跑不注入 / D3 重启后状态重建 / H1 会话回收
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

let seq = 0;

async function boot(opts) {
  const o = opts || {};
  const tier = o.tier || "light";
  const home = mkdtempSync(join(tmpdir(), "pmui-audit-"));
  mkdirSync(join(home, "plan-mode-ui"), { recursive: true });
  writeFileSync(join(home, "plan-mode-ui", "state.json"),
    JSON.stringify({ version: 1, default: { tier, scope: "always", max: false }, sessions: {} }));
  process.env.DSH_HOME = home;
  const handlers = new Map();
  let route = null;
  const seen = [];
  const commands = { execute: (agent, line) => { seen.push(line); return Promise.resolve({ commandId: "c", result: { kind: "success" } }); } };
  const { default: plugin } = await import("../lib/index.js?audit" + (++seq) + "-" + Date.now());
  const ctx = {
    get: (n) => (n === "commands" ? commands : undefined),
    on: (n, fn) => handlers.set(n, fn),
    inject: () => {}, effect: (fn) => { try { fn(); } catch (e) {} },
    webServer: { register: (spec) => { route = spec.handler; return () => {}; } },
    systemPrompt: { section: () => {}, getSectionOrder: () => 500 },
    logger: { warn() {}, info() {} }
  };
  if (o.projections) ctx.sessionProjections = o.projections;
  plugin.apply(ctx);
  const session = { id: "audit-" + seq, delegationDepth: 0 };
  const register = () => handlers.get("agent/created")?.({ agent: { session, steer() {}, inject() {} } });
  register();
  const call = (method, body) => new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = "/api/plan-mode/state?session=" + encodeURIComponent(session.id);
    req.headers = method === "POST"
      ? { host: "127.0.0.1:3081", "content-type": "application/json", "x-plan-mode-client": "1" }
      : { host: "127.0.0.1:3081" };
    const res = { writeHead() {}, end(text) { resolve(JSON.parse(text)); } };
    route(req, res);
    if (method === "POST") { req.emit("data", Buffer.from(JSON.stringify(body || {}))); }
    req.emit("end");
  });
  return {
    fire: (n, ...a) => handlers.get(n)?.(...a), session, seen, register,
    state: () => call("GET"), post: (b) => call("POST", b),
    dispose: () => handlers.get("agent/disposed")?.({ agent: { session } })
  };
}

const userMsg = (turn) => ({ type: "user/message", data: { turn, content: [{ type: "text", text: "继续" }], source: { kind: "user" } } });
const tick = () => new Promise((r) => setTimeout(r, 20));

// A1（D1）：用户手动 /plan 开的原生，切到「关闭」不得被误关
{
  const c = await boot({ tier: "light" });
  c.fire("session/event", c.session, { type: "plan/mode", data: { active: true } });
  if ((await c.state()).native !== true) throw new Error("A1 前置：手动原生没记上");
  await c.post({ tier: "off" });
  await tick();
  if (c.seen.includes("/plan off")) throw new Error("A1 切关闭时误关了用户手动开的原生计划，seen=" + JSON.stringify(c.seen));
  if ((await c.state()).native !== true) throw new Error("A1 簿记被越权清掉（native 应仍为 true）");
  console.log("PASS A1 切「关闭」只关插件自己开的，不误关手动 /plan");
}

// A2（D1 正向 + C2）：插件自己桥接的，切「关闭」要真的发 /plan off 并清桥接簿记
{
  const c = await boot({ tier: "light" });
  c.fire("session/event", c.session, { type: "turn/start", data: { turn: 1 } });
  c.fire("session/event", c.session, userMsg(1));
  await tick();
  if (!c.seen.includes("/plan")) throw new Error("A2 前置：没桥接上，seen=" + JSON.stringify(c.seen));
  await c.post({ tier: "off" });
  await tick();
  if (!c.seen.includes("/plan off")) throw new Error("A2 切关闭后没发 /plan off，seen=" + JSON.stringify(c.seen));
  if ((await c.state()).debug.bridge.sessions !== 0) throw new Error("A2 桥接簿记没清");
  console.log("PASS A2 桥接中的会话切「关闭」→ 立即 /plan off 且簿记清零");
}

// A3（D2）：原生已在跑时，full 档不得再注入 PHASE 1（也不该白发一次 /plan）
{
  const c = await boot({ tier: "full" });
  c.fire("session/event", c.session, { type: "plan/mode", data: { active: true } });
  c.fire("session/event", c.session, { type: "turn/start", data: { turn: 2 } });
  c.fire("session/event", c.session, userMsg(2));
  await tick();
  if (c.seen.includes("/plan")) throw new Error("A3 原生已在跑却又发了一次 /plan，seen=" + JSON.stringify(c.seen));
  const d = await c.state();
  if (d.phase === "planning") throw new Error("A3 原生已在跑却建了 planning 记录（会注入 PHASE 1）");
  if ((d.debug.gate.builtin || 0) < 1) throw new Error("A3 gate.builtin 没有计数，压制没走到");
  console.log("PASS A3 原生已在跑 → 不注入 PHASE 1、不重复 /plan（gate.builtin=" + d.debug.gate.builtin + "）");
}

// A4（D3）：重启/热重载后从会话投影校准原生状态（不依赖 plan/mode 事件）
{
  const c = await boot({ tier: "light", projections: { stateOf: (s, name) => (name === "plan" ? { active: true } : undefined) } });
  const d = await c.state();
  if (d.native !== true) throw new Error("A4 没有从会话投影重建原生状态，native=" + d.native);
  console.log("PASS A4 agent 就绪时按会话投影校准原生状态（native=true，无 plan/mode 事件）");
}

// A5（H1）：会话销毁后决策簿记被回收，同一个回合号能重新决策
{
  const c = await boot({ tier: "light" });
  c.fire("session/event", c.session, { type: "turn/start", data: { turn: 1 } });
  c.fire("session/event", c.session, userMsg(1));
  await tick();
  const first = c.seen.filter((x) => x === "/plan").length;
  if (first !== 1) throw new Error("A5 前置：第一轮应桥接 1 次，实际 " + first);
  c.dispose();
  c.register();
  c.fire("session/event", c.session, { type: "turn/start", data: { turn: 1 } });
  c.fire("session/event", c.session, userMsg(1));
  await tick();
  const second = c.seen.filter((x) => x === "/plan").length;
  if (second !== 2) throw new Error("A5 disposed 后 decidedTurn 没回收，同一回合号被旧决策挡住（实际 " + second + "）");
  console.log("PASS A5 会话销毁后决策簿记回收，重建后同一回合号可重新决策");
}

// A6：切到轻量/全量 = 立刻进入原生计划模式（对称于"关闭即退出"），不用等下一句话
{
  const c = await boot({ tier: "off" });
  if ((await c.state()).native !== false) throw new Error("A6 前置：off 档不该有原生");
  await c.post({ tier: "light" });
  await tick();
  if (!c.seen.includes("/plan")) throw new Error("A6 切到轻量后没有立刻进入计划模式，seen=" + JSON.stringify(c.seen));
  if ((await c.state()).native !== true) throw new Error("A6 切到轻量后 native 仍为 false");
  console.log("PASS A6 切到「轻量」→ 立刻 /plan，native=true（不等下一句话）");
}

// A7（D4）：full 档"主动退出"不能被当成批准（否则退出即开始执行）
{
  const c = await boot({ tier: "full" });
  c.fire("session/event", c.session, { type: "turn/start", data: { turn: 1 } });
  c.fire("session/event", c.session, userMsg(1));
  await tick();
  if (!c.seen.includes("/plan")) throw new Error("A7 前置：full 档没桥接上，seen=" + JSON.stringify(c.seen));
  await c.post({ action: "plan-off" });
  await tick();
  c.fire("session/event", c.session, { type: "plan/mode", data: { active: false } });
  const d = await c.state();
  if (d.indicator === "planned" || d.indicator === "executing") {
    throw new Error("A7 主动退出被当成了批准（indicator=" + d.indicator + "），会直接投递执行阶段");
  }
  if (d.debug.records !== 0) throw new Error("A7 取消后仍留着执行阶段记录：" + d.debug.records);
  console.log("PASS A7 full 档主动退出 = 取消（不记已计划、不建执行记录，indicator=" + d.indicator + "）");
}

// A8：无头降级开关 —— 没有审批通道时不桥接，任务照常完成
{
  process.env.DSH_PLAN_MODE_UI_HEADLESS = "off";
  try {
    const c = await boot({ tier: "light" });
    c.fire("session/event", c.session, { type: "turn/start", data: { turn: 1 } });
    c.fire("session/event", c.session, userMsg(1));
    await tick();
    if (c.seen.includes("/plan")) throw new Error("A8 无头环境下仍桥接了，seen=" + JSON.stringify(c.seen));
    const d = await c.state();
    if (d.debug.headless !== true) throw new Error("A8 状态里没有 headless 标记");
    if (d.indicator !== "off") throw new Error("A8 无头环境 indicator 应为 off，实际 " + d.indicator);
    console.log("PASS A8 无头开关 =off → 不桥接、无注入、indicator=off");
  } finally { delete process.env.DSH_PLAN_MODE_UI_HEADLESS; }
}
