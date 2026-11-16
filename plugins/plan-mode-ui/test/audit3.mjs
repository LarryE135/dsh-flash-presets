// 2026-11-17 全量审计（外部报告）的回归测试：
// 1) 宿主事件是 {type,seq,time,data}，user/message 不带 turn —— scope 门控必须仍然生效；
// 2) 改档位不能丢掉本会话的 autoApprove；
// 3) 守卫只认调用形态（含 ?. 与方括号取值），且自动批准只放行 exit_plan_mode；
// 4) 交付门关着时一个字都不注入。
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

let failed = 0;
const ok = (cond, msg) => { if (cond) console.log("  ✓ " + msg); else { failed += 1; console.log("  ✗ " + msg); } };

function home(settings) {
  const h = mkdtempSync(join(tmpdir(), "pmui-a3-"));
  mkdirSync(join(h, "plan-mode-ui"), { recursive: true });
  writeFileSync(join(h, "plan-mode-ui", "state.json"), JSON.stringify({ version: 1, ...settings }));
  process.env.DSH_HOME = h;
  return h;
}

let seq = 0;
async function boot(settings) {
  home(settings);
  const handlers = new Map();
  const calls = [];
  let route = null;
  const svc = { set(a, v) { calls.push(["set", v]); return "committed"; }, loggedActive() { return false; } };
  const { default: plugin } = await import("../lib/index.js?a3-" + (++seq));
  const ctx = {
    get: (n) => (n === "planMode" ? svc : undefined),
    on: (n, fn) => { handlers.set(n, fn); },
    inject: () => {},
    effect: (fn) => { try { fn(); } catch (e) {} },
    webServer: { register: (spec) => { if (String(spec.path).endsWith("/state")) route = spec.handler; return () => {}; } },
    systemPrompt: { section: () => {}, getSectionOrder: () => 500 },
    logger: { warn() {}, info() {} },
  };
  plugin.apply(ctx);
  const fire = (session, event) => handlers.get("session/event")?.(session, event);
  const call = (sid, method, body) => new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = "/api/plan-mode/state" + (sid === null ? "" : "?session=" + encodeURIComponent(sid));
    req.headers = { host: "127.0.0.1:3081", "content-type": "application/json", "x-plan-mode-client": "1" };
    const res = { writeHead() {}, end(text) { resolve(JSON.parse(text)); } };
    route(req, res);
    if (method === "POST") { req.emit("data", Buffer.from(JSON.stringify(body || {}))); req.emit("end"); }
  });
  const agent = (session, extra) => {
    const a = { session, ...extra };
    handlers.get("agent/created")?.({ agent: a });
    return a;
  };
  return { fire, calls, agent, get: (sid) => call(sid, "GET"), post: (sid, body) => call(sid, "POST", body) };
}

const userMsg = (text) => ({ type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text }] } });

{
  const b = await boot({ default: { tier: "light", scope: "auto", max: false, autoApprove: false }, sessions: {} });
  const session = { id: "shape-1", delegationDepth: 0 };
  b.agent(session, { steer() {}, inject() {} });
  b.fire(session, { type: "turn/start", data: { turn: 1 } });
  b.fire(session, userMsg("写一个 CSV 解析器，要求列名映射"));
  const first = b.calls.filter(([n, v]) => n === "set" && v === true).length;
  ok(first === 1, "宿主机形态：第 1 回合进入计划模式 1 次（实际 " + first + "）");
  b.fire(session, { type: "turn/end", data: { turn: 1 } });
  b.fire(session, { type: "turn/start", data: { turn: 2 } });
  b.fire(session, userMsg("好的"));
  const total = b.calls.filter(([n, v]) => n === "set" && v === true).length;
  ok(total === 1, "宿主机形态：第 2 回合短句不重进计划模式（累计 " + total + "，旧代码会是 2）");
}

{
  const b = await boot({ default: { tier: "light", scope: "auto", max: false, autoApprove: false }, sessions: {} });
  await b.post("S1", { autoApprove: true });
  await b.post("S1", { tier: "full" });
  const s = await b.get("S1");
  ok(s.tier === "full", "改档位后 tier=full");
  ok(s.autoApprove === true, "改档位后 autoApprove 仍是 true（不再静默回落）");
}

{
  const mod = await import("../lib/index.js?a3-guard");
  const f = mod.__reviewTimeoutReasonForTest;
  const run = (code, timeoutMs) => ({ name: "run_code", arguments: { code, ...(timeoutMs === undefined ? {} : { timeoutMs }) } });
  ok(typeof f(run('await tools["exit_plan_mode"]({ plan })')) === "string", "方括号取值调用被拦");
  ok(typeof f(run("await exit_plan_mode?.({ plan })")) === "string", "可选调用 exit_plan_mode?.() 被拦");
  ok(f(run("my_exit_plan_mode({ plan })")) === undefined, "标识符后缀 my_exit_plan_mode( 不再误拦");
  ok(f(run('const help = "later we call exit_plan_mode";')) === undefined, "字符串里只提到名字（不带括号）不拦");
  ok(typeof f(run("await tools.ask_user_question({ questions })")) === "string", "提问仍然要超时");
  const skipExitOnly = (agent, tool) => tool === "exit_plan_mode";
  ok(f(run("await tools.exit_plan_mode({ plan })"), skipExitOnly) === undefined, "自动批准放行计划评审");
  ok(typeof f(run("await tools.ask_user_question({ questions })"), skipExitOnly) === "string",
    "自动批准不放行普通提问（#29 提问路径不再复发）");
}

{
  const dg = await import("../../../lib/delivery-gate.js?a3-dg");
  let registered = null;
  const mk = () => ({
    get: () => undefined,
    on: () => () => {},
    effect: (fn) => { try { fn(); } catch (e) {} },
    systemPrompt: { section: (spec) => { registered = spec; return () => {}; } },
  });
  dg.apply(mk(), { enabled: false });
  ok(registered !== null, "交付门仍注册 section 占位（默认名）");
  ok(registered.text() === "", "关闭时 section 文本为空（不再注入不存在的 verify 工具）");
  registered = null;
  dg.apply(mk(), { enabled: true });
  ok(String(registered.text()).includes("acceptance script"), "开启时有正文");
  ok(!String(registered.text()).includes("verify tool"), "正文不再提不存在的 verify 工具");
}

if (failed > 0) { console.log(failed + " 项失败"); process.exit(1); }
console.log("全部通过");
