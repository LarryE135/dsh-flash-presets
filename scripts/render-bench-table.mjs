#!/usr/bin/env node
// README 的实测表格由 docs/bench-office-results.json 生成，避免手抄数字（0.461 vs 0.481 那种错）。
//   node scripts/render-bench-table.mjs --check   只比对本，不一致退出 1
//   node scripts/render-bench-table.mjs --write   写回两份 README
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const data = JSON.parse(fs.readFileSync(path.join(root, "docs/bench-office-results.json"), "utf8"));

const BEGIN = "<!-- bench-table:begin（本块由 scripts/render-bench-table.mjs 生成，勿手改）-->";
const END = "<!-- bench-table:end -->";
const MINUS = "\u2212";

const fmtM = (r, en) => r.m.toFixed(3) + " M" + (en ? "(n=" : "（n=") + r.n + (en ? ")" : "）");
const fmtPct = d => (d === null ? "—" : MINUS + Math.abs(d).toFixed(1) + "%");
const base = data.rows[0];
const pct = (row, suite) => {
  if (row.key === base.key) return null; // 基准行自身不显示降幅
  const b = base[suite].m;
  const v = row[suite].m;
  return b ? (1 - v / b) * 100 : null;
};

function render(lang) {
  const en = lang === "en";
  const head = en
    ? "| Setup | " + data.suites.map(s => s.en).join(" | vs standard | ") + " | vs standard |"
    : "| 配置 | " + data.suites.map(s => s.zh).join(" | 相对标准模式 | ") + " | 相对标准模式 |";
  const align = "|---|" + data.suites.map(() => "---:|---:").join("|") + "|";
  const body = data.rows.map(row => {
    const cells = data.suites.map(s => fmtM(row[s.id], en) + " | " + fmtPct(pct(row, s.id)));
    return "| " + (en ? row.en : row.zh) + " | " + cells.join(" | ") + " |";
  });
  return [head, align, ...body].join("\n");
}

const targets = [
  { file: "README.md", lang: "zh" },
  { file: "README.en.md", lang: "en" },
];
const write = process.argv.includes("--write");
let bad = 0;
for (const t of targets) {
  const p = path.join(root, t.file);
  const src = fs.readFileSync(p, "utf8");
  const i = src.indexOf(BEGIN);
  const j = src.indexOf(END);
  if (i < 0 || j < i) {
    console.log("  ✖ " + t.file + " 缺少 bench-table 标记（加一行 " + BEGIN + "）");
    bad++;
    continue;
  }
  const current = src.slice(i + BEGIN.length, j).replace(/^\n+|\n+$/g, "");
  const want = render(t.lang);
  if (current === want) { console.log("  ✓ " + t.file + " 实测表与 JSON 一致"); continue; }
  if (write) {
    fs.writeFileSync(p, src.slice(0, i + BEGIN.length) + "\n" + want + "\n" + src.slice(j), "utf8");
    console.log("  ✎ " + t.file + " 已按 JSON 重写");
  } else {
    console.log("  ✖ " + t.file + " 实测表与 JSON 不一致（跑 --write 重写）");
    bad++;
  }
}
process.exit(bad ? 1 : 0);