// 0.5.0 审计修复的回归测试：scope 记账 / 驳回后批准 / full 只首轮桥接
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let seq = 0;
function prepareHome(tier, scope) {
  const home = mkdtempSync(join(tmpdir(), "pmui-"));
  mkdirSync(join(home, "plan-mode-ui"), { recursive: true });
  writeFileSync(join(home, "plan-mode-ui", "state.json"), JSON.stringify({ version: 1, default: { tier, scope, max: false }, sessions: {} }));
  return home;
}

async function boot(tier, scope) {
  process.env.DSH_HOME = prepareHome(tier, scope);
  const { default: plugin } = await import("../lib/index.js?case" + (++seq));
  const handlers = new Map();
  const sets = [];
  const steers = [];
  const svc = { set(a, v) { sets.push(v); return "committed"; }, loggedActive() { return false; } };
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
  const session = { id: "case-" + seq, delegationDepth: 0 };
  const agent = { session, steer(m) { steers.push(JSON.stringify(m)); }, inject() {} };
  handlers.get("agent/created")?.({ agent });
  const fire = (n, ...a) => handlers.get(n)?.(...a);
  return { fire, session, agent, sets, steers };
}

// F1：light + scope=first，第二回合（无 turn 号）不得再进计划模式
{
  const c = await boot("light", "first");
  c.fire("session/event", c.session, { type: "turn/start" });
  c.fire("session/event", c.session, { type: "turn/end" });
  c.fire("session/event", c.session, { type: "turn/start" });
  const enters = c.sets.filter((v) => v === true).length;
  if (enters !== 1) throw new Error("F1 期望只进 1 次计划模式，实际 " + enters);
  console.log("PASS F1 light+scope=first 第二回合不再重进计划模式");
}

// F2：full 驳回后批准（阶段记录已被 turn/end 清理）仍要投递 PHASE 2
{
  const c = await boot("full", "always");
  c.fire("session/event", c.session, { type: "turn/start" });
  c.fire("session/event", c.session, { type: "turn/end" });          // 记录被清
  c.fire("session/event", c.session, { type: "plan/mode", data: { active: false } }); // 之后才批准
  const hit = c.steers.filter((s) => s.includes("PHASE 2")).length;
  if (hit === 0) throw new Error("F2 批准后没有投递 PHASE 2");
  console.log("PASS F2 驳回后批准仍能投递 PHASE 2（" + hit + " 次）");
}

// F3：full 批准后再开新回合，走旧自动续跑，不再弹评审卡
{
  const c = await boot("full", "always");
  c.fire("session/event", c.session, { type: "turn/start" });
  c.fire("session/event", c.session, { type: "plan/mode", data: { active: false } }); // 批准
  c.fire("session/event", c.session, { type: "turn/end" });
  const before = c.sets.filter((v) => v === true).length;
  c.fire("session/event", c.session, { type: "turn/start" });
  const after = c.sets.filter((v) => v === true).length;
  if (after !== before) throw new Error("F3 第二回合又进了计划模式");
  console.log("PASS F3 full 批准后不再重复进入原生计划模式");
}
