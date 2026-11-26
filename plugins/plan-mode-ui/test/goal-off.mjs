// #45：档位为 off 时，目标模式的自动回合（非用户输入）也要退出本插件开过的原生计划模式；重启后同样成立
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let seq = 0;
const home = mkdtempSync(join(tmpdir(), "pmui-goal-"));
mkdirSync(join(home, "plan-mode-ui"), { recursive: true });
const setTier = (tier) => writeFileSync(join(home, "plan-mode-ui", "state.json"), JSON.stringify({ version: 1, default: { tier, scope: "always", max: false }, sessions: {} }));

async function boot(nativeActive) {
  process.env.DSH_HOME = home;
  const { default: plugin } = await import("../lib/index.js?goal" + (++seq));
  const handlers = new Map();
  const sets = [];
  const native = { active: nativeActive };
  const svc = { set(a, v) { sets.push(v); native.active = v; return "committed"; }, loggedActive() { return native.active; } };
  const proj = { stateOf: () => ({ active: native.active }) };
  const ctx = {
    get: (n) => (n === "planMode" ? svc : n === "sessionProjections" ? proj : undefined),
    on: (n, fn) => { handlers.set(n, fn); },
    inject: () => {}, effect: (fn) => { try { fn(); } catch (e) {} },
    webServer: { register: () => () => {} },
    systemPrompt: { section: () => {}, getSectionOrder: () => 500 },
    logger: { warn() {}, info() {} }
  };
  plugin.apply(ctx);
  const session = { id: "goal-session", delegationDepth: 0 };
  const agent = { session, steer() {}, inject() {} };
  handlers.get("agent/created")?.({ agent });
  return { fire: (n, ...a) => handlers.get(n)?.(...a), session, sets, native };
}

// G1：light 档首回合由插件进入原生计划模式
setTier("light");
{
  const c = await boot(false);
  c.fire("session/event", c.session, { type: "turn/start", data: { turn: 1 } });
  if (c.native.active !== true) throw new Error("G1 light 首回合应进入原生计划模式");
  const saved = JSON.parse(readFileSync(join(home, "plan-mode-ui", "sessions.json"), "utf8"));
  if (saved.bridged?.["id:goal-session"] === undefined) throw new Error("G1 桥接归属未落盘");
  console.log("PASS G1 light 首回合进入原生计划模式且归属落盘");
}
// G2：重启（内存簿记清空）+ 切到 off + 目标模式自动回合（第 3 回合，无用户输入）→ 退出
setTier("off");
{
  const c = await boot(true);
  c.fire("session/event", c.session, { type: "turn/start", data: { turn: 3 } });
  await new Promise((r) => setTimeout(r, 0));
  if (c.native.active !== false || !c.sets.includes(false)) throw new Error("G2 关档后目标回合未退出原生计划模式（sets=" + JSON.stringify(c.sets) + "）");
  const saved = JSON.parse(readFileSync(join(home, "plan-mode-ui", "sessions.json"), "utf8"));
  if (saved.bridged?.["id:goal-session"] !== undefined) throw new Error("G2 退出后归属未清除");
  console.log("PASS G2 重启后关档，目标模式自动回合退出插件开的计划模式");
}
// G3：用户自己 /plan 开的（无归属）在 off 档不被动
{
  const c = await boot(true);
  c.fire("session/event", c.session, { type: "turn/start", data: { turn: 4 } });
  await new Promise((r) => setTimeout(r, 0));
  if (c.native.active !== true || c.sets.length !== 0) throw new Error("G3 不应退出用户手动开的计划模式");
  console.log("PASS G3 用户手动 /plan 不受关档影响");
}
