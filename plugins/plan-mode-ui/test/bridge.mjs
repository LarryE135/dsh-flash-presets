// 0.5.0 桥接冒烟：light/full 走向原生 plan mode；off 不桥接；没有该服务时回退旧行为
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function prepareHome(tier) {
  const home = mkdtempSync(join(tmpdir(), "pmui-"));
  mkdirSync(join(home, "plan-mode-ui"), { recursive: true });
  writeFileSync(join(home, "plan-mode-ui", "state.json"), JSON.stringify({ version: 1, default: { tier, scope: "always", max: false }, sessions: {} }));
  return home;
}

async function scenario({ tier, withService, label }) {
  process.env.DSH_HOME = prepareHome(tier);
  const { default: plugin } = await import("../lib/index.js?" + label);
  const handlers = new Map();
  const calls = [];
  const svc = { set(a, v) { calls.push(["set", v]); return "committed"; }, loggedActive() { return false; } };
  const ctx = {
    get: (n) => (withService && n === "planMode" ? svc : undefined),
    on: (n, fn) => { handlers.set(n, fn); },
    inject: () => {},
    effect: (fn) => { try { fn(); } catch (e) {} },
    webServer: { register: () => () => {} },
    systemPrompt: { section: () => {}, getSectionOrder: () => 500 },
    logger: { warn() {}, info() {} }
  };
  plugin.apply(ctx);
  const session = { id: "bridge-" + label, delegationDepth: 0 };
  const agent = { session, steer() {}, inject() {} };
  handlers.get("agent/created")?.({ agent });
  handlers.get("session/event")?.(session, { type: "turn/start", turn: 1 });
  const entered = calls.some(([n, v]) => n === "set" && v === true);
  if (withService && tier !== "off" && !entered) throw new Error(label + ": 没有进入原生 plan mode");
  if ((!withService || tier === "off") && entered) throw new Error(label + ": 不该进入原生 plan mode");
  console.log("PASS " + label);
}

await scenario({ tier: "light", withService: true, label: "B1 light 桥接" });
await scenario({ tier: "full", withService: true, label: "B2 full 桥接" });
await scenario({ tier: "off", withService: true, label: "B3 off 不桥接" });
await scenario({ tier: "light", withService: false, label: "B4 无服务回退旧行为" });
