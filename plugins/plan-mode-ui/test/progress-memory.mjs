// 有界性：四个监测表都走 capSet（CACHE_MAX=500），多会话不会无限增长
import { boot, report } from "./helpers/progress.mjs";

const P = "/api/plan-mode/progress";
let failed = 0;
function ok(name, cond, extra) {
  if (!cond) { console.error("✗ " + name + (extra === undefined ? "" : "  -> " + extra)); failed += 1; }
  else console.log("✓ " + name);
}

const { session, fire, call } = await boot("full");

// 600 个不同会话各写一次 todo，再各触发一次滞后 → 三个表都会被灌
for (let i = 0; i < 600; i += 1) {
  const s = { id: "mem-" + i, delegationDepth: 0 };
  fire("session/event", s, { type: "todo/write", turn: 1, data: { todos: [
    { content: "A", status: "completed" }, { content: "B", status: "in_progress" }, { content: "C", status: "pending" }] } });
  fire("session/event", s, { type: "turn/end", turn: 9 });
}

const res = await call("GET", P, null, session.id);
const d = res.body.debug;
ok("tracked 有界", d.tracked <= 500, String(d.tracked));
ok("turns 有界", d.turns <= 500, String(d.turns));
ok("nudges 有界", d.nudges <= 500, String(d.nudges));
ok("counters 有界", d.counters <= 500, String(d.counters));
ok("确实灌满了（否则这个测试没意义）", d.tracked >= 400, String(d.tracked));

report(failed, "progress-memory");
