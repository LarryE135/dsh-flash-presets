#!/usr/bin/env node
// p-sort-files judge：node judge.mjs <workspaceDir>
// 输出单行 JSON：{ score, maxScore, verdict, timeMs, peakMemMB, detail }
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2];
const limits = JSON.parse(fs.readFileSync(path.join(here, 'limits.json'), 'utf8'));

function expectedTake() {
  const values = [];
  for (const name of limits.dataFiles) {
    const text = fs.readFileSync(path.join(here, 'data', name), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (/^-?\d+$/.test(line.trim())) values.push(Number(line.trim()));
    }
  }
  return [...new Set(values)].sort((a, b) => a - b).slice(0, limits.take);
}

const expected = expectedTake();
const result = { score: 0, maxScore: limits.maxScore, verdict: '', timeMs: 0, peakMemMB: undefined, detail: '' };
const problems = [];

const answerPath = path.join(dir, limits.answerFile);
let answerLines = null;
try {
  answerLines = fs.readFileSync(answerPath, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => l.trim());
} catch { /* missing */ }
if (answerLines === null) problems.push(`${limits.answerFile} 缺失`);
else if (answerLines.length !== expected.length || answerLines.some((v, i) => v !== String(expected[i]))) {
  problems.push(`${limits.answerFile} 与标准前 ${limits.take} 个数不一致`);
}

const runPath = path.join(dir, limits.runFile);
let solverTime = 0;
if (!fs.existsSync(runPath)) {
  problems.push(`${limits.runFile} 缺失`);
} else {
  const t0 = Date.now();
  const run = spawnSync(process.execPath, [runPath], {
    cwd: dir,
    encoding: 'utf8',
    timeout: limits.timeLimitMs + 2000,
  });
  solverTime = Date.now() - t0;
  if (run.error) problems.push(`${limits.runFile} 执行失败：${run.error.message}`);
  else if (run.signal || run.status === null) problems.push(`${limits.runFile} 超时（>${limits.timeLimitMs} ms）或被杀`);
  else {
    const out = (run.stdout || '').split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => l.trim());
    const ok = out.length === expected.length && out.every((v, i) => v === String(expected[i]));
    if (!ok) problems.push(`${limits.runFile} 输出与标准前 ${limits.take} 个数不一致`);
  }
}

const verifyPath = path.join(dir, limits.verifyLog);
if (!fs.existsSync(verifyPath)) problems.push(`${limits.verifyLog} 缺失（要求留下核对证据）`);

result.timeMs = Math.max(solverTime, 0);
result.verdict = problems.length === 0 ? 'AC' : 'WA';
result.score = problems.length === 0 ? limits.maxScore : 0;
result.detail = problems.join('; ') || '全部通过';
console.log(JSON.stringify(result));
process.exit(problems.length === 0 ? 0 : 1);
