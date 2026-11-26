// 0.3.4 审计 P1：PTC 子调用（tool/ptc-dispatch-start → tool/ptc-dispatch）不能让 pendingTools 只加不减。
// 原来 start 走 onToolStart 会 +1，而 end 只摘 pendingPtc —— 计数净增，2×TTL 兜底就会误删长调用回合的记录。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "lib", "index.js");
const probe = join(here, "..", "lib", ".ptc-flight-probe-" + process.pid + ".js");
writeFileSync(probe, readFileSync(src, "utf8") + "\nexport { pendingTools as __pt, pendingPtc as __pp, phaseRecords as __pr, pruneStale as __prune };\n");
try {
  const root = mkdtempSync(join(tmpdir(), "pmui-ptc-"));
  const home = join(root, "h"); const cwd = join(root, "c");
  mkdirSync(join(home, "plan-mode-ui"), { recursive: true }); mkdirSync(cwd, { recursive: true });
  writeFileSync(join(home, "plan-mode-ui", "state.json"), JSON.stringify({ version: 1, default: { tier: "full", scope: "always", max: false }, sessions: {} }));
  process.env.DSH_HOME = home;
  const mod = await import(probe);
  const handlers = new Map();
  mod.default.apply({ effect(fn) { return fn(); }, on(ev, cb) { handlers.set(ev, cb); }, webServer: { register() { return () => {}; } }, systemPrompt: { section() { return {}; }, getSectionOrder() { return 500; } }, get() { return null; } });
  const emit = (ev, s) => handlers.get("session/event")(s, ev);
  const session = { id: "s1", cwd, delegationDepth: 0 };
  handlers.get("agent/created")({ agent: { session, steer() {} } });
  emit({ type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: "实现导出功能" }], turn: 1 }, session);
  emit({ type: "turn/start", turn: 1 }, session);
  emit({ type: "tool/call", name: "run_code", callId: "c1", turn: 1 }, session);
  for (let i = 0; i < 5; i++) {
    emit({ type: "tool/ptc-dispatch-start", name: "read", subCallId: "s" + i }, session);
    emit({ type: "tool/ptc-dispatch", name: "read", subCallId: "s" + i }, session);
  }
  emit({ type: "tool/result", turn: 1, message: {} }, session);
  const left = mod.__pt.get("id:s1") ?? 0;
  if (left !== 0) throw new Error("P1 5 个 PTC 子调用结束后 pendingTools 应为 0，实际 " + left);
  console.log("PASS P1a PTC 子调用不再让 pendingTools 只加不减");
  const hadRecord = mod.__pr.has("id:s1");
  const realNow = Date.now; const t0 = realNow();
  try {
    Date.now = () => t0 + 29 * 60000;
    emit({ type: "tool/ptc-dispatch-start", name: "render", subCallId: "long" }, session);
    Date.now = () => t0 + 31 * 60000;
    mod.__prune();
  } finally { Date.now = realNow; }
  if (hadRecord && !mod.__pr.has("id:s1")) throw new Error("P1 仍在飞行的长 PTC 调用，其回合记录被 2×TTL 兜底误删");
  console.log("PASS P1b 长 PTC 调用在飞行时回合记录保留" + (hadRecord ? "" : "（本环境未生成记录，只验计数）"));
  rmSync(root, { recursive: true, force: true });
} finally {
  rmSync(probe, { force: true });
}
