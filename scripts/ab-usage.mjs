#!/usr/bin/env node
// 汇总一次 dsh --json 运行的用量：node scripts/ab-usage.mjs <events.jsonl>
// 输出一行：tokens turns final
import fs from "node:fs";
const f = process.argv[2];
if (!f) { console.error("用法: node scripts/ab-usage.mjs <events.jsonl>"); process.exit(2); }
let tokens = 0, turns = 0, final = false;
for (const line of fs.readFileSync(f, "utf8").split("\n")) {
  if (!line.startsWith("{")) continue;
  let e; try { e = JSON.parse(line); } catch { continue; }
  if (e.usage && typeof e.usage.totalTokens === "number") tokens += e.usage.totalTokens;
  if (e.type === "status") turns++;
  if (e.type === "final") final = true;
}
console.log(tokens + " " + turns + " " + (final ? "final" : "nofinal"));
