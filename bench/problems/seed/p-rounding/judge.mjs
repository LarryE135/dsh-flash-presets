#!/usr/bin/env node
// p-rounding judge：node judge.mjs <workspaceDir>
// 输出单行 JSON：{ score, maxScore, verdict, timeMs, peakMemMB, detail }
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2];
const limits = JSON.parse(fs.readFileSync(path.join(here, 'limits.json'), 'utf8'));
const input = JSON.parse(fs.readFileSync(path.join(here, 'input.json'), 'utf8'));

const n = input.n;
const mean = input.values.reduce((s, v) => s + v, 0) / n;
const variance = input.values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (n - 1);
const expected = Number(variance.toFixed(12));

const result = { score: 0, maxScore: limits.maxScore, verdict: '', timeMs: 0, peakMemMB: undefined, detail: '' };
const problems = [];

const readNumber = (p) => {
  try { return Number(fs.readFileSync(p, 'utf8').trim()); } catch { return NaN; }
};

const answerPath = path.join(dir, limits.answerFile);
const answer = readNumber(answerPath);
if (!Number.isFinite(answer)) problems.push(`${limits.answerFile} 缺失或不是数字`);
else if (Math.abs(answer - expected) > limits.tolerance) problems.push(`${limits.answerFile} 超出容差：${answer}（期望 ${expected}）`);

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
    const out = Number((run.stdout || '').trim());
    if (!Number.isFinite(out) || Math.abs(out - expected) > limits.tolerance) {
      problems.push(`${limits.runFile} 输出超出容差：${(run.stdout || '').trim().slice(0, 40)}（期望 ${expected}）`);
    }
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
