// 进度推导：四态 + lag 数学 + 边界
import { deriveProgress, syncLine } from "../lib/progress.js";

let failed = 0;
function eq(name, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error("✗ " + name + "\n  got  " + a + "\n  want " + b); failed += 1; }
  else console.log("✓ " + name);
}

const t = (list) => list;

// 空表 → unused
const empty = deriveProgress({ todos: [], turn: 7, lastWriteTurn: 0 });
eq("空表 health", empty.health, "unused");
eq("空表 lagTurns", empty.lagTurns, 0);
eq("空表 counts", empty.counts, { total: 0, completed: 0, inProgress: 0, pending: 0 });

// 全部完成 → synced（即使很久没写也不再算滞后）
const done = deriveProgress({ todos: [{ content: "a", status: "completed" }, { content: "b", status: "completed" }], turn: 9, lastWriteTurn: 1 });
eq("全完成 health", done.health, "synced");
eq("全完成 lagTurns", done.lagTurns, 8);

// 正常推进 → synced
const ok = deriveProgress({ todos: t([{ content: "a", status: "completed" }, { content: "b", status: "in_progress" }, { content: "c", status: "pending" }]), turn: 3, lastWriteTurn: 2 });
eq("刚写过 health", ok.health, "synced");
eq("刚写过 lagTurns", ok.lagTurns, 1);
eq("刚写过 counts", ok.counts, { total: 3, completed: 1, inProgress: 1, pending: 1 });

// 滞后：超过阈值且有 pending
const lag = deriveProgress({ todos: t([{ content: "a", status: "completed" }, { content: "b", status: "in_progress" }, { content: "c", status: "pending" }]), turn: 6, lastWriteTurn: 3, threshold: 2 });
eq("滞后 health", lag.health, "lagging");
eq("滞后 lagTurns", lag.lagTurns, 3);

// 停滞：没有 in_progress 且远超阈值
const stalled = deriveProgress({ todos: t([{ content: "a", status: "completed" }, { content: "b", status: "pending" }]), turn: 10, lastWriteTurn: 2, threshold: 2 });
eq("停滞 health", stalled.health, "stalled");

// 阈值可调：threshold=5 时 3 轮不算滞后
const loose = deriveProgress({ todos: t([{ content: "a", status: "pending" }]), turn: 4, lastWriteTurn: 1, threshold: 5 });
eq("阈值放宽 health", loose.health, "synced");

// 非法输入不炸
const junk = deriveProgress({ todos: [null, { status: "weird" }, { content: 42 }], turn: NaN, lastWriteTurn: undefined });
eq("脏数据 total", junk.counts.total, 3);
eq("脏数据 pending", junk.counts.pending, 3);

// 提醒文案
const line = syncLine({ lagTurns: 3, health: "lagging", counts: { total: 4, completed: 1, pending: 3 } });
eq("提醒含落后轮数", line.includes("3 turn(s) behind"), true);
eq("提醒含进度", line.includes("1/4"), true);
eq("提醒含动作", line.includes("todo_write"), true);

if (failed > 0) { console.error(failed + " 个用例失败"); process.exit(1); }
console.log("progress-derive 全部通过");
