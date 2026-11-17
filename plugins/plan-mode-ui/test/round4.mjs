// 第四轮审计的回归用例：PTC 事件与 tool/call 的语义一致、PHASE 2 记账可回滚、补投不跨回合
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const tmpHome = "/tmp/pmo-r4-home";
const tmpCwd = "/tmp/pmo-r4-cwd";
rmSync(tmpHome, { recursive: true, force: true });
rmSync(tmpCwd, { recursive: true, force: true });
mkdirSync(join(tmpHome, "plan-mode-ui"), { recursive: true });
mkdirSync(tmpCwd, { recursive: true });
writeFileSync(join(tmpHome, "plan-mode-ui", "state.json"), JSON.stringify({
  version: 1, default: { tier: "full", scope: "always", max: false }, sessions: {}
}));
process.env.DSH_HOME = tmpHome;

const mod = await import(new URL("../lib/index.js", import.meta.url).href);
const handlers = new Map();
mod.default.apply({
  effect(fn) { return fn(); },
  on(ev, cb) { handlers.set(ev, cb); },
  webServer: { register() { return () => {}; } },
  systemPrompt: { section() { return {}; }, getSectionOrder() { return 500; } },
  get() { return null; }
});
const emit = (ev, session) => handlers.get("session/event")(session, ev);
const STOP = handlers.get("agent/turn-stopping");

const rows = [];
const check = (n, c, e) => rows.push({ n, pass: !!c, e: e === undefined ? "" : String(e).replace(/\s+/g, " ").slice(0, 80) });
const tick = () => new Promise((r) => setTimeout(r, 0));
const mkSession = (id) => ({ id, cwd: tmpCwd, delegationDepth: 0 });
const steers = [];
const mkAgent = (session, opts = {}) => ({
  session,
  steer(msg) {
    const text = msg && msg.content && msg.content[0] ? String(msg.content[0].text) : String(msg);
    steers.push(text);
    if (opts.throwOnSteer === true) throw new Error("simulated steer failure");
  },
});
const planFile = () => {
  mkdirSync(join(tmpCwd, ".plan-mode"), { recursive: true });
  writeFileSync(join(tmpCwd, ".plan-mode", "plan.md"), "goal\nsteps\nchecks\n");
};
const clearPlan = () => rmSync(join(tmpCwd, ".plan-mode"), { recursive: true, force: true });

/* 1. PTC：计划已交付后继续动手 → 收尾不该再催（与 tool/call 同语义） */
{
  clearPlan();
  const session = mkSession("ptc-parity");
  const agent = mkAgent(session);
  handlers.get("agent/created")({ agent });
  emit({ type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: "实现导出" }], turn: 1 }, session);
  emit({ type: "turn/start", turn: 1 }, session);
  planFile();
  steers.length = 0;
  for (const name of ["read", "read"]) {
    emit({ type: "tool/ptc-dispatch-start", name, turn: 1 }, session);
    emit({ type: "tool/ptc-dispatch", name, turn: 1 }, session);
  }
  await tick();
  check("1a PTC 下计划已落地 → 不纠偏", steers.length === 0, steers.join(" | "));
  await STOP({ agent, turn: 1, signal: { aborted: false } });
  await tick();
  check("1b PTC 下已在执行 → 收尾不再追加 PHASE 2", steers.length === 0, steers.join(" | "));
}

/* 2. PTC：规划期先动手 → 纠偏一次（不比 tool/call 多、也不少） */
{
  clearPlan();
  const session = mkSession("ptc-nudge");
  const agent = mkAgent(session);
  handlers.get("agent/created")({ agent });
  emit({ type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: "实现导出" }], turn: 1 }, session);
  emit({ type: "turn/start", turn: 1 }, session);
  steers.length = 0;
  emit({ type: "tool/ptc-dispatch-start", name: "write", turn: 1 }, session);
  emit({ type: "tool/ptc-dispatch", name: "write", turn: 1 }, session);
  await tick();
  check("2a 规划期动手被纠偏（PLAN FIRST）", steers.length === 1 && steers[0].indexOf("PLAN FIRST") === 0, steers[0] && steers[0].slice(0, 24));
  emit({ type: "tool/ptc-dispatch-start", name: "edit", turn: 1 }, session);
  emit({ type: "tool/ptc-dispatch", name: "edit", turn: 1 }, session);
  await tick();
  check("2b 只纠偏一次", steers.length === 1, steers.length);
}

/* 3. 补投不跨回合：上一回合的批准不能塞进下一回合的规划步 */
{
  clearPlan();
  const session = mkSession("pending-stale");
  emit({ type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: "实现导出" }], turn: 1 }, session);
  emit({ type: "turn/start", turn: 1 }, session);
  emit({ type: "assistant/message", turn: 1, message: { content: [{ type: "text", text: "计划：先读再写" }] } }, session);
  steers.length = 0;
  emit({ type: "plan/mode", data: { active: false }, turn: 1 }, session);   // 批准（此会话没有 agent）
  await tick();
  check("3a 没有 agent 时不投递", steers.length === 0, steers.length);
  emit({ type: "turn/end", turn: 1 }, session);
  emit({ type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: "继续" }], turn: 2 }, session);
  emit({ type: "turn/start", turn: 2 }, session);
  await tick();
  check("3b 跨回合的补投被丢弃", steers.length === 0, steers.length);
}

/* 4. 投递失败要回滚记账：同回合还能再投一次 */
{
  clearPlan();
  const session = mkSession("rollback");
  const agent = mkAgent(session, { throwOnSteer: true });
  handlers.get("agent/created")({ agent });
  emit({ type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: "实现导出" }], turn: 1 }, session);
  emit({ type: "turn/start", turn: 1 }, session);
  emit({ type: "assistant/message", turn: 1, message: { content: [{ type: "text", text: "计划：先读再写" }] } }, session);
  steers.length = 0;
  emit({ type: "plan/mode", data: { active: false }, turn: 1 }, session);
  await tick();
  const first = steers.length;
  emit({ type: "plan/mode", data: { active: true }, turn: 1 }, session);
  emit({ type: "plan/mode", data: { active: false }, turn: 1 }, session);
  await tick();
  check("4a 第一次投递确实尝试过", first === 1, first);
  check("4b 失败后记账回滚，同回合还能再投", steers.length === 2, steers.length);
}

const pass = rows.filter((r) => r.pass).length;
console.log("第四轮回归：" + pass + "/" + rows.length);
for (const r of rows) console.log((r.pass ? "PASS " : "FAIL ") + r.n + (r.e ? "  [" + r.e + "]" : ""));
process.exit(pass === rows.length ? 0 : 1);
