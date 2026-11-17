// 第四轮/第五轮审计的回归用例：PTC 事件与 tool/call 语义一致、PHASE 2 记账可回滚、补投不跨回合、
// 「计划刚落盘就动手」不受 1 秒探测节流影响
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "pmo-r4-"));
const tmpHome = join(root, "home");
const tmpCwd = join(root, "cwd");
mkdirSync(join(tmpHome, "plan-mode-ui"), { recursive: true });
mkdirSync(tmpCwd, { recursive: true });
writeFileSync(join(tmpHome, "plan-mode-ui", "state.json"), JSON.stringify({
  version: 1, default: { tier: "full", scope: "always", max: false }, sessions: {}
}));
process.env.DSH_HOME = tmpHome;

const cleanup = () => rmSync(root, { recursive: true, force: true });
process.on("exit", cleanup);

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
const check = (n, c, e) => rows.push({ n, pass: !!c, e: e === undefined ? "" : String(e).replace(/\s+/g, " ").slice(0, 70) });
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
const boot = (id, startedAtEvents) => {
  clearPlan();
  const session = mkSession(id);
  const agent = mkAgent(session);
  handlers.get("agent/created")({ agent });
  emit({ type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: "实现导出" }], turn: 1 }, session);
  emit({ type: "turn/start", turn: 1 }, session);
  steers.length = 0;
  return { session, agent };
};

/* 1. 计划已落地后继续动手 → 收尾不再催；write 才是真「动手」 */
{
  const { session, agent } = boot("ptc-parity");
  planFile();
  for (const name of ["write", "read"]) {
    emit({ type: "tool/ptc-dispatch-start", name, subCallId: name + "-1", turn: 1 }, session);
    emit({ type: "tool/ptc-dispatch", name, subCallId: name + "-1", turn: 1 }, session);
  }
  await tick();
  check("1a 计划已落地 → 动手不纠偏", steers.length === 0, steers.join(" | "));
  await STOP({ agent, turn: 1, signal: { aborted: false } });
  await tick();
  check("1b 已在执行 → 收尾不再追加 PHASE 2", steers.length === 0, steers.join(" | "));
}

/* 1c. 同一窗口内（1 秒探测节流期间）连着动手也要算「已在执行」 */
{
  const { session, agent } = boot("ptc-throttle");
  // 第一次调用发生在计划落盘之前，随后立刻写计划、再连发两次 —— 全落在 PLAN_PROBE_MS 窗口里
  emit({ type: "tool/ptc-dispatch-start", name: "read", subCallId: "r-1", turn: 1 }, session);
  emit({ type: "tool/ptc-dispatch", name: "read", subCallId: "r-1", turn: 1 }, session);
  planFile();
  // 让「发现计划」的时刻落在这次工具开始之前
  await new Promise((r) => setTimeout(r, 1100));
  for (const id of ["w-1", "w-2"]) {
    emit({ type: "tool/ptc-dispatch-start", name: "write", subCallId: id, turn: 1 }, session);
    emit({ type: "tool/ptc-dispatch", name: id, subCallId: id, turn: 1 }, session);
  }
  await tick();
  await STOP({ agent, turn: 1, signal: { aborted: false } });
  await tick();
  check("1c 节流窗口内的连续动手也算已在执行", steers.length === 0, steers.join(" | "));
}

/* 2. 规划期先动手：只认开始事件，且只纠偏一次 */
{
  const { session } = boot("ptc-nudge");
  emit({ type: "tool/ptc-dispatch", name: "write", subCallId: "a-1", turn: 1 }, session);   // 只有结束
  await tick();
  check("2a 只有结束事件 → 不纠偏", steers.length === 0, steers.join(" | "));
  emit({ type: "tool/ptc-dispatch-start", name: "write", subCallId: "a-2", turn: 1 }, session);
  await tick();
  check("2b 开始事件 → 纠偏一次（PLAN FIRST）", steers.length === 1 && steers[0].indexOf("PLAN FIRST") === 0, steers[0] && steers[0].slice(0, 24));
  emit({ type: "tool/ptc-dispatch-start", name: "edit", subCallId: "a-3", turn: 1 }, session);
  await tick();
  check("2c 只纠偏一次", steers.length === 1, steers.length);
}

/* 3. 补投不跨回合：上一回合的批准不能塞进下一回合的规划步 */
{
  const { session } = boot("pending-stale");
  emit({ type: "assistant/message", turn: 1, message: { content: [{ type: "text", text: "计划：先读再写" }] } }, session);
  emit({ type: "plan/mode", data: { active: false }, turn: 1 }, session);   // 暂无 agent 之外的障碍
  await tick();
  steers.length = 0;
  emit({ type: "turn/end", turn: 1 }, session);
  handlers.get("agent/created")({ agent: mkAgent(session) });   // 下一回合前 agent 就绪，排除「投不出去」的干扰
  emit({ type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: "继续" }], turn: 2 }, session);
  emit({ type: "turn/start", turn: 2 }, session);
  await tick();
  check("3 跨回合的补投被丢弃", steers.length === 0, steers.join(" | "));
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
console.log("第四轮/第五轮回归：" + pass + "/" + rows.length);
for (const r of rows) console.log((r.pass ? "PASS " : "FAIL ") + r.n + (r.e ? "  [" + r.e + "]" : ""));
cleanup();
process.exit(pass === rows.length ? 0 : 1);
