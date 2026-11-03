// /api/plan-mode/progress：形状、事件驱动、nudge / reset、错误码
import { boot, report } from "./helpers/progress.mjs";

const P = "/api/plan-mode/progress";
let failed = 0;
function eq(name, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error("✗ " + name + "\n  got  " + a + "\n  want " + b); failed += 1; }
  else console.log("✓ " + name);
}

const { session, fire, call } = await boot("full");

const noSession = await call("GET", P);
eq("无 session 不报错", [noSession.status, noSession.body.ok, noSession.body.reason], [200, true, "no-session"]);

const empty = await call("GET", P, null, session.id);
eq("空状态 ok", empty.body.ok, true);
eq("空状态 health", empty.body.health, "unused");
eq("空状态默认档", [empty.body.mode, empty.body.lagThreshold], ["remind", 2]);
eq("空状态带 plan 字段", typeof empty.body.plan, "object");

// 模型写入 todo（第 2 回合）
fire("session/event", session, { type: "todo/write", turn: 2, data: { todos: [
  { content: "README", status: "completed" },
  { content: "接口", status: "in_progress" },
  { content: "测试", status: "pending" }
] } });
const afterWrite = await call("GET", P, null, session.id);
eq("写入后 total", afterWrite.body.counts.total, 3);
eq("写入后 completed", afterWrite.body.counts.completed, 1);
eq("写入后 health", afterWrite.body.health, "synced");
eq("写入后来源", afterWrite.body.source, "events");

// 跑到第 6 回合都没再写 → 滞后
fire("session/event", session, { type: "assistant/message", turn: 6, message: { content: [] } });
fire("session/event", session, { type: "turn/end", turn: 6 });
const lagged = await call("GET", P, null, session.id);
eq("滞后判定", lagged.body.health, "lagging");
eq("滞后轮数", lagged.body.lagTurns, 4);

// 手动 nudge
const nudged = await call("POST", P, { session: session.id, action: "nudge" });
eq("nudge 排队", [nudged.status, nudged.body.ok, nudged.body.queued], [200, true, true]);

// reset
const reset = await call("POST", P, { session: session.id, action: "reset" });
eq("reset 成功", [reset.status, reset.body.ok], [200, true]);
const afterReset = await call("GET", P, null, session.id);
eq("reset 后回到 unused", afterReset.body.health, "unused");

// 非法 action / 缺 session
const bad = await call("POST", P, { session: session.id, action: "explode" });
eq("非法 action 400", [bad.status, bad.body.ok], [400, false]);
const noSid = await call("POST", P, { action: "nudge" });
eq("POST 缺 session 400", [noSid.status, noSid.body.ok], [400, false]);

// CSRF 考勤：与 /state 一致，不带 x-plan-mode-client 的 POST 一律 403
const csrf = await call("POST", P, { session: session.id, action: "nudge" }, null, { client: false });
eq("POST 无客户端头 403", [csrf.status, csrf.body.ok], [403, false]);

// 响应里的 plan 语义拆分 + debug 尺寸
const shape = await call("GET", P, null, session.id);
eq("plan 三字段", Object.keys(shape.body.plan).sort(), ["approved", "native", "planned"]);
eq("debug 有界字段", Object.keys(shape.body.debug).sort(), ["counters", "nudges", "tracked", "turns"]);

report(failed, "progress-endpoint");
