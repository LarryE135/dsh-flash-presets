// 真实事件契约：todo/write 不带 turn（turn 只能从 turn/start|turn/end 的 data.turn 取）
// 这一条在 0.6.1 上是红的（lastWriteTurn 永远 0 → lagTurns 恒等于当前回合号）。
import { boot, report } from "./helpers/progress.mjs";

const P = "/api/plan-mode/progress";
let failed = 0;
function ok(name, cond, extra) {
  if (!cond) { console.error("✗ " + name + (extra === undefined ? "" : "  -> " + extra)); failed += 1; }
  else console.log("✓ " + name);
}

const h = await boot("light");
const { session, fire, call } = h;
const todos = [
  { content: "A", status: "completed" },
  { content: "B", status: "in_progress" },
  { content: "C", status: "pending" }
];

// 真实形状：turn/start 带 data.turn；todo/write 只有 data.todos；turn/end 带 data.turn
fire("session/event", session, { type: "turn/start", data: { turn: 2 } });
fire("session/event", session, { type: "todo/write", data: { todos } });
fire("session/event", session, { type: "turn/end", data: { turn: 2 } });

const same = (await call("GET", P, null, session.id)).body;
ok("同回合写入 → lagTurns=0", same.lagTurns === 0, JSON.stringify({ lag: same.lagTurns, health: same.health, last: same.lastWriteTurn }));
ok("同回合写入 → health=synced", same.health === "synced", same.health);
ok("lastWriteTurn 等于当前回合", same.lastWriteTurn === 2, String(same.lastWriteTurn));

// 走两回合不更新 → 滞后 2
fire("session/event", session, { type: "turn/start", data: { turn: 3 } });
fire("session/event", session, { type: "turn/end", data: { turn: 3 } });
fire("session/event", session, { type: "turn/start", data: { turn: 4 } });
fire("session/event", session, { type: "turn/end", data: { turn: 4 } });
const lag = (await call("GET", P, null, session.id)).body;
ok("两回合未更新 → lagTurns=2", lag.lagTurns === 2, String(lag.lagTurns));
ok("两回合未更新 → lagging", lag.health === "lagging", lag.health);

// strict 模式：即使没有滞后也要提醒
const s = await boot("light", { config: { todoSync: "strict" } });
s.fire("session/event", s.session, { type: "turn/start", data: { turn: 2 } });
s.fire("session/event", s.session, { type: "todo/write", data: { todos } });
s.fire("session/event", s.session, { type: "turn/end", data: { turn: 2 } });
const stext = s.section();
ok("strict：零滞后也提醒", stext.includes("TODO SYNC (auto)"), JSON.stringify(stext.slice(-120)));
ok("strict：纪律段仍在", stext.includes("TODO SYNC (do not batch)"));

// remind 模式：零滞后不提醒（用干净会话，避免上面已排队的提醒串场）
const clean = await boot("light");
clean.fire("session/event", clean.session, { type: "turn/start", data: { turn: 1 } });
clean.fire("session/event", clean.session, { type: "todo/write", data: { todos } });
clean.fire("session/event", clean.session, { type: "turn/end", data: { turn: 1 } });
ok("remind：零滞后不提醒", !clean.section().includes("TODO SYNC (auto)"));
// strict 模式下同一份干净事件应提醒
const strictClean = await boot("light", { config: { todoSync: "strict" } });
strictClean.fire("session/event", strictClean.session, { type: "turn/start", data: { turn: 1 } });
strictClean.fire("session/event", strictClean.session, { type: "todo/write", data: { todos } });
strictClean.fire("session/event", strictClean.session, { type: "turn/end", data: { turn: 1 } });
ok("strict：干净会话也提醒", strictClean.section().includes("TODO SYNC (auto)"));

report(failed, "progress-contract");
