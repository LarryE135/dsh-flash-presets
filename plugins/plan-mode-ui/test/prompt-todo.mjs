// 提示词：todo 纪律在任何档位都在；滞后提醒一次性且有额度、同步后复位
import { boot, report } from "./helpers/progress.mjs";

let failed = 0;
function ok(name, cond, extra) {
  if (!cond) { console.error("✗ " + name + (extra === undefined ? "" : "  -> " + extra)); failed += 1; }
  else console.log("✓ " + name);
}

const full = await boot("full");
const text = full.section();
ok("full 档含 todo 纪律段", text.includes("TODO SYNC (do not batch)"), text.slice(0, 100));
ok("纪律段要求 todo_write", text.includes("todo_write"));
ok("纪律段禁止攒到最后", text.includes("finish line is stale"));
ok("纪律段要求逐项打勾", text.includes("After EVERY tool result"));
ok("无滞后时不含自动提醒", !text.includes("TODO SYNC (auto)"));

const light = await boot("light");
const ltext = light.section();
ok("light 档也含 todo 纪律段", ltext.includes("TODO SYNC (do not batch)"), JSON.stringify(ltext.slice(0, 120)));
ok("light 档不再注入完整 P0 协议", !ltext.includes("P0-EXEC.yml uses exactly these keys"));

const nativeP = { stateOf: (session, keyName) => (keyName === "plan" ? { active: true } : null) };
const native = await boot("full", { projections: nativeP });
const ntext = native.section();
// 原生接管 = 规划阶段：此时注入"延后建列表"版（纪律版会与 plan mode 打架）
ok("原生接管时仍含 todo 段", ntext.includes("TODO SYNC (deferred)"), JSON.stringify(ntext.slice(0, 120)));
ok("原生接管时不给「立刻建列表」指令", !ntext.includes("Before the first tool call"));
ok("原生接管时不再注入验收正文", !ntext.includes("P0-EXEC.yml uses exactly these keys"));

const off = await boot("off");
ok("off 档不注入 todo 段", !off.section().includes("TODO SYNC"));

const { session, fire } = full;
// 保留一个 in_progress：这样健康度是 lagging（额度 2），不会滑到 stalled（额度 4）
fire("session/event", session, { type: "todo/write", turn: 1, data: { todos: [
  { content: "A", status: "completed" }, { content: "B", status: "in_progress" }, { content: "C", status: "pending" }] } });
fire("session/event", session, { type: "turn/end", turn: 6 });
const n1 = full.section();
ok("滞后后注入自动提醒", n1.includes("TODO SYNC (auto)"), n1.slice(-140));
ok("提醒带落后轮数", /\d+ turn\(s\) behind/.test(n1));
ok("提醒带进度分数", /1\/3/.test(n1));
ok("提醒只注入一次", !full.section().includes("TODO SYNC (auto)"));

fire("session/event", session, { type: "turn/end", turn: 7 });
ok("第二次滞后仍提醒（额度内）", full.section().includes("TODO SYNC (auto)"));
fire("session/event", session, { type: "turn/end", turn: 8 });
ok("额度用尽后不再提醒", !full.section().includes("TODO SYNC (auto)"));

fire("session/event", session, { type: "todo/write", turn: 9, data: { todos: [
  { content: "A", status: "completed" }, { content: "B", status: "in_progress" }] } });
fire("session/event", session, { type: "turn/end", turn: 14 });
ok("同步成功后可再次提醒（额度复位）", full.section().includes("TODO SYNC (auto)"));

report(failed, "prompt-todo");
