// Progress derivation for plan-mode-ui: pure functions, no DSH imports.
//
// 目的：把「todos 写没写、写晚了没有」变成可观测的健康度，而不是等任务快结束才打勾。
// 规则集中在这里，index.js 只做 IO，测试只测这个文件。

const STATUSES = new Set(["pending", "in_progress", "completed"]);

/**
 * Normalize one todo row.
 * @param {unknown} row
 * @param {number} index
 * @returns {{ index: number, content: string, status: string }}
 */
function normalize(row, index) {
  const r = row !== null && typeof row === "object" ? row : {};
  const status = STATUSES.has(r.status) ? r.status : "pending";
  return { index, content: String(r.content ?? ""), status };
}

/**
 * Derive the health of the todo list relative to the current turn.
 *
 * @param {object} input
 * @param {Array<{content?: string, status?: string}>|null|undefined} input.todos
 * @param {number} input.turn             current turn number
 * @param {number} input.lastWriteTurn    turn of the last todo/write (0 = never wrote)
 * @param {number} [input.threshold]      turns of lag tolerated before flagging
 * @returns {{ items: Array<{index:number,content:string,status:string}>,
 *            counts: {total:number,completed:number,inProgress:number,pending:number},
 *            lagTurns: number,
 *            health: "unused"|"synced"|"lagging"|"stalled" }}
 */
export function deriveProgress({ todos, turn, lastWriteTurn, threshold = 2 } = {}) {
  const list = Array.isArray(todos) ? todos : [];
  const items = list.map(normalize);
  const counts = { total: items.length, completed: 0, inProgress: 0, pending: 0 };
  for (const item of items) {
    if (item.status === "completed") counts.completed += 1;
    else if (item.status === "in_progress") counts.inProgress += 1;
    else counts.pending += 1;
  }
  const now = Number.isFinite(turn) ? Math.max(0, turn) : 0;
  const wrote = Number.isFinite(lastWriteTurn) ? Math.max(0, lastWriteTurn) : 0;
  const thr = Number.isFinite(threshold) && threshold >= 1 ? Math.floor(threshold) : 2;
  const lagTurns = counts.total === 0 ? 0 : Math.max(0, now - wrote);

  let health;
  if (counts.total === 0) health = "unused";
  else if (counts.pending === 0 && counts.inProgress === 0) health = "synced";
  else if (counts.inProgress === 0 && lagTurns >= thr + 2) health = "stalled";
  else if (lagTurns >= thr) health = "lagging";
  else health = "synced";

  return { items, counts, lagTurns, health };
}

/**
 * One-shot reminder injected into the next prompt assembly.
 * @param {{ lagTurns: number, health: string, counts: {pending:number,completed:number,total:number} }} progress
 * @returns {string}
 */
export function syncLine(progress) {
  const lag = progress?.lagTurns ?? 0;
  const counts = progress?.counts ?? { pending: 0, completed: 0, total: 0 };
  const done = counts.completed + "/" + counts.total;
  return [
    "TODO SYNC (auto): you are " + lag + " turn(s) behind on todo status (" + done + " marked).",
    "Before any other work this turn, call todo_write with the current list — mark what is actually",
    "finished as completed and keep at most one item in_progress — then continue."
  ].join(" ");
}
