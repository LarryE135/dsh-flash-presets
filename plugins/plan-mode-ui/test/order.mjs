// DSH 0.2.x 真实事件顺序：turn/start → user/message（此前假设反了，导致除首回合外从不规划）
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let seq = 0;
function boot(tier, scope) {
  const home = mkdtempSync(join(tmpdir(), "pmui-order-"));
  mkdirSync(join(home, "plan-mode-ui"), { recursive: true });
  writeFileSync(join(home, "plan-mode-ui", "state.json"), JSON.stringify({ version: 1, default: { tier, scope, max: false }, sessions: {} }));
  process.env.DSH_HOME = home;
  return import("../lib/index.js?order" + (++seq)).then(({ default: plugin }) => {
    const handlers = new Map();
    const calls = [];
    const svc = { set(a, v) { calls.push(["set", v]); return "committed"; }, loggedActive() { return false; } };
    const ctx = {
      get: (n) => (n === "planMode" ? svc : undefined),
      on: (n, fn) => { handlers.set(n, fn); },
      inject: () => {},
      effect: (fn) => { try { fn(); } catch (e) {} },
      webServer: { register: () => () => {} },
      systemPrompt: { section: () => {}, getSectionOrder: () => 500 },
      logger: { warn() {}, info() {} }
    };
    plugin.apply(ctx);
    const session = { id: "order-" + seq, delegationDepth: 0 };
    const agent = { session, steer() {}, inject() {} };
    handlers.get("agent/created")?.({ agent });
    return { fire: (n, ...a) => handlers.get(n)?.(...a), session, calls };
  });
}

// O1：light，第 2 回合（真实顺序）也要桥接
{
  const c = await boot("light", "always");
  const userMsg = { type: "user/message", data: { turn: 2, content: [{ type: "text", text: "继续" }], source: { kind: "user" } } };
  c.fire("session/event", c.session, { type: "turn/start", data: { turn: 2 } });
  c.fire("session/event", c.session, userMsg);
  const entered = c.calls.filter(([, v]) => v === true).length;
  if (entered !== 1) throw new Error("O1 期望第 2 回合也进入计划模式，实际 " + entered);
  console.log("PASS O1 light：turn/start → user/message 顺序下第 2 回合也桥接");
}

// O2：off 档不桥接
{
  const c = await boot("off", "always");
  c.fire("session/event", c.session, { type: "turn/start", data: { turn: 2 } });
  c.fire("session/event", c.session, { type: "user/message", data: { turn: 2, content: [{ type: "text", text: "hi" }], source: { kind: "user" } } });
  if (c.calls.some(([, v]) => v === true)) throw new Error("O2 off 档不该桥接");
  console.log("PASS O2 off 档不桥接");
}

// O3：助手已经出过话（回合进行中的插话）不再触发决策
{
  const c = await boot("light", "always");
  c.fire("session/event", c.session, { type: "turn/start", data: { turn: 3 } });
  c.fire("session/event", c.session, { type: "assistant/message", data: { turn: 3, message: { content: [{ type: "text", text: "先看看" }] } } });
  c.fire("session/event", c.session, { type: "user/message", data: { turn: 3, content: [{ type: "text", text: "插一句" }], source: { kind: "user" } } });
  if (c.calls.some(([, v]) => v === true)) throw new Error("O3 回合中插话不该触发规划");
  console.log("PASS O3 回合中插话不触发规划");
}
