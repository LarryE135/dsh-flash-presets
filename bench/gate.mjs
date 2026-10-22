#!/usr/bin/env node
/**
 * 回归门 —— 把最新一批 runs 与 baseline 对比，越限即失败。
 *
 *   node bench/gate.mjs --runs bench/results/runs.csv --baseline bench/results/baseline.csv
 *
 * 规则（按 problem × preset × arm 分组，取中位数）：
 *   - score 不得低于 baseline；
 *   - billed_input 增幅 ≤ --max-cost-rise（默认 15%）；
 *   - wall_ms 增幅 ≤ --max-wall-rise（默认 30%）。
 * 无 baseline 时 exit 0 并提示「第一次跑：把结果复制为 baseline」。
 * 消融臂（rules_kept 以 minus- 开头）只参与报告，不参与回归判定。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};

const runsPath = opt('--runs', path.join(repo, 'bench', 'results', 'runs.csv'));
const baselinePath = opt('--baseline', path.join(repo, 'bench', 'results', 'baseline.csv'));
const maxCostRise = Number(opt('--max-cost-rise', '0.15'));
const maxWallRise = Number(opt('--max-wall-rise', '0.3'));

function readCsv(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = [];
    let cur = '';
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { cells.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur);
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
}

const median = (xs) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const group = (rows) => {
  const map = new Map();
  for (const r of rows) {
    const key = `${r.problem}|${r.preset}|${r.arm}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return map;
};

const num = (v) => Number(v);
const runs = readCsv(runsPath).filter((r) => !String(r.rules_kept).startsWith('minus-'));
if (runs.length === 0) {
  console.log('最新 runs 里没有非消融行，无需回归判定。');
  process.exit(0);
}
if (!fs.existsSync(baselinePath)) {
  console.log('没有 baseline（' + baselinePath + '）：第一次跑，把本轮结果复制为 baseline 即可（不做判定，exit 0）。');
  process.exit(0);
}
const baseline = readCsv(baselinePath).filter((r) => !String(r.rules_kept).startsWith('minus-'));

let failed = 0;
const rows = [];
for (const [key, runRows] of group(runs)) {
  const baseRows = group(baseline).get(key);
  const score = median(runRows.map((r) => num(r.score)));
  const cost = median(runRows.map((r) => num(r.billed_input)));
  const wall = median(runRows.map((r) => num(r.wall_ms)));
  if (!baseRows || baseRows.length === 0) {
    rows.push({ key, verdict: '新组（无 baseline）', score, cost, wall });
    continue;
  }
  const bScore = median(baseRows.map((r) => num(r.score)));
  const bCost = median(baseRows.map((r) => num(r.billed_input)));
  const bWall = median(baseRows.map((r) => num(r.wall_ms)));
  const costRise = bCost > 0 ? (cost - bCost) / bCost : 0;
  const wallRise = bWall > 0 ? (wall - bWall) / bWall : 0;
  const problems = [];
  if (score < bScore) problems.push(`分数 ${score} < baseline ${bScore}`);
  if (costRise > maxCostRise) problems.push(`计费 +${(costRise * 100).toFixed(1)}% > ${(maxCostRise * 100).toFixed(0)}%（${cost} vs ${bCost}）`);
  if (wallRise > maxWallRise) problems.push(`墙钟 +${(wallRise * 100).toFixed(1)}% > ${(maxWallRise * 100).toFixed(0)}%（${wall} vs ${bWall} ms）`);
  if (problems.length) failed++;
  rows.push({ key, verdict: problems.length ? 'REGRESSION：' + problems.join('；') : 'OK', score, cost, wall });
}

console.log('组（problem|preset|arm）\t\t判定');
for (const r of rows) console.log(`${r.key}\t${r.verdict}`);
console.log(failed ? `\n回归门失败：${failed} 组越限。` : '\n回归门通过。');
process.exit(failed ? 1 : 0);
