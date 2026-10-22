#!/usr/bin/env node
// p-prime-gap judge：node judge.mjs <workspaceDir>
// 输出单行 JSON：{ score, maxScore, verdict, timeMs, peakMemMB, detail }
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2];
const limits = JSON.parse(fs.readFileSync(path.join(here, 'limits.json'), 'utf8'));
const A = 900000;
const B = 1000000;

function sieve(lo, hi) {
  const size = hi - lo + 1;
  const isPrime = new Array(size).fill(true);
  const limit = Math.floor(Math.sqrt(hi));
  const small = [];
  const mark = new Array(limit + 1).fill(true);
  for (let i = 2; i <= limit; i++) {
    if (!mark[i]) continue;
    small.push(i);
    for (let j = i * i; j <= limit; j += i) mark[j] = false;
  }
  for (const p of small) {
    const start = Math.max(p * p, Math.ceil(lo / p) * p);
    for (let j = start; j <= hi; j += p) isPrime[j - lo] = false;
  }
  const primes = [];
  for (let i = 0; i < size; i++) if (isPrime[i] && lo + i >= 2) primes.push(lo + i);
  return primes;
}

const primes = sieve(A, B);
const gaps = [];
for (let i = 1; i < primes.length; i++) gaps.push(primes[i] - primes[i - 1]);
const expected = primes.length >= 2 ? Math.max(...gaps) : 0;

const result = { score: 0, maxScore: limits.maxScore, verdict: '', timeMs: 0, peakMemMB: undefined, detail: '' };
const problems = [];

const answerPath = path.join(dir, limits.answerFile);
let answer = null;
try { answer = fs.readFileSync(answerPath, 'utf8').trim(); } catch { /* missing */ }
if (answer === null) problems.push(`${limits.answerFile} 缺失`);
else if (!/^\d+$/.test(answer)) problems.push(`${limits.answerFile} 不是单个整数：${answer.slice(0, 40)}`);
else if (Number(answer) !== expected) problems.push(`${limits.answerFile} 答案错误：${answer}（期望 ${expected}）`);

const runPath = path.join(dir, limits.runFile);
let solverTime = 0;
let solverMatches = false;
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
    solverMatches = (run.stdout || '').trim() === String(expected);
    if (!solverMatches) problems.push(`${limits.runFile} 输出与标准答案不一致：${(run.stdout || '').trim().slice(0, 40)}`);
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
