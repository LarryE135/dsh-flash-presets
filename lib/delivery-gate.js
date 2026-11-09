// 交付门（delivery-gate）：把「验收」从 persona 里的一句话，变成运行时机制。
//
// 为什么需要它：2026-11-08 的三臂实测里，三份实现都在结束语里如实写了「17–19 超时 / 未覆盖」，
// 然后照常交付 —— 说明「要求写清楚」这一层已经到位，缺的是「不达标就不许结束」。
// 10-19 的 C 臂之所以能从 16/19 走到 19/19，靠的正是外部把失败清单回灌进去重跑。
//
// 机制：
//   1. 工具 verify：跑一次验收脚本（默认工作区里的 verify.sh），回传 pass/fail 与尾部输出；
//   2. 回合收尾钩子：工作区里有验收脚本且本轮还没跑过 → 自动跑；不通过就 steer 一条
//      「失败清单 + 不要交付」的消息，同一会话最多补 maxRounds 次；
//   3. system prompt 里只有一行提示，规则文本不长在提示词里。
//
// 关掉：配置 enabled: false，或环境变量 DSH_DELIVERY_GATE=0。
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const name = 'delivery-gate';
export const inject = ['systemPrompt'];

export const Config = z.object({
  /** 总开关；也可用 DSH_DELIVERY_GATE=0 关掉 */
  enabled: z.boolean().default(true),
  /** 验收脚本候选名（按序找第一个存在的） */
  scripts: z.array(z.string()).default(['verify.sh']),
  /** 同一会话最多回灌几次 */
  maxRounds: z.number().default(2),
  /** 单次验收的超时（毫秒） */
  timeoutMs: z.number().default(900000),
  /** 回灌消息里引用多少字符的尾部输出 */
  tailChars: z.number().default(1200)
});

const TAG = '[delivery-gate]';
const SESSION_CAP = 200;
// 两次自动验收的最小间隔：turn-stopping 会在回合内的步与步之间也触发
const MIN_GAP_MS = 15000;

function log(message) {
  try { console.info(TAG + ' ' + message); } catch (error) {}
}

function isOff(config) {
  if (process.env.DSH_DELIVERY_GATE === '0') return true;
  return config.enabled !== true;
}

function findScript(cwd, names) {
  if (typeof cwd !== 'string' || cwd.length === 0) return null;
  for (const candidate of names) {
    const file = path.resolve(cwd, candidate);
    try { if (statSync(file).isFile()) return file; } catch (error) {}
  }
  return null;
}

// 一次验收：拿退出码 + 尾部输出。不抛，失败也当数据。
function runScript(file, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const win = process.platform === 'win32';
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;
    try {
      child = win
        ? spawn('pwsh', ['-NoProfile', '-NonInteractive', '-File', file], { cwd, windowsHide: true })
        : spawn('/bin/bash', [file], { cwd, windowsHide: true });
    } catch (error) {
      resolve({ ok: false, code: null, out: String(error && error.message), seconds: 0, timedOut: false });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch (error) {}
    }, timeoutMs);
    child.stdout.on('data', (buf) => { stdout += String(buf); });
    child.stderr.on('data', (buf) => { stderr += String(buf); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, out: String(error && error.message), seconds: 0, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const seconds = Math.round((Date.now() - startedAt) / 100) / 10;
      resolve({ ok: code === 0 && timedOut !== true, code, out: (stdout + stderr).trim(), seconds, timedOut });
    });
  });
}

function cwdOf(agent, session) {
  const fromBox = (box) => {
    if (box === undefined || box === null || typeof box !== 'object') return null;
    for (const field of ['cwd', 'dir', 'workspace', 'workdir']) {
      if (typeof box[field] === 'string' && existsSync(box[field])) return box[field];
    }
    for (const field of ['meta', 'metadata', 'header', 'info']) {
      const nested = box[field];
      if (nested !== undefined && nested !== null && typeof nested === 'object' && typeof nested.cwd === 'string' && existsSync(nested.cwd)) return nested.cwd;
    }
    return null;
  };
  return fromBox(session) ?? (agent !== undefined && agent !== null ? fromBox(agent.session) : null) ?? process.cwd();
}

function maybeResolve(config) {
  const base = { enabled: true, scripts: ['verify.sh'], maxRounds: 2, timeoutMs: 900000, tailChars: 1200 };
  const merged = { ...base, ...(config || {}) };
  if (Array.isArray(merged.scripts) && merged.scripts.length === 0) merged.scripts = base.scripts;
  return merged;
}

function sessionKey(agent) {
  const direct = agent && agent.session && (agent.session.id || agent.session.sessionId);
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const fallback = agent && (agent.id || agent.agentId);
  return typeof fallback === 'string' && fallback.length > 0 ? fallback : 'default';
}

async function resolveCwd(ctx, exec) {
  try {
    const service = typeof ctx.get === 'function' ? ctx.get('workingDirectory') : undefined;
    if (service !== undefined && typeof service.ensure === 'function') {
      const dir = await service.ensure(exec.agent, exec.signal);
      if (typeof dir === 'string' && dir.length > 0) return dir;
    }
  } catch (error) {}
  return cwdOf(exec.agent, exec.agent && exec.agent.session);
}

export function apply(ctx, config) {
  const resolved = maybeResolve(config);
  const state = new Map();

  const remember = (key, value) => {
    if (state.size > SESSION_CAP) state.delete(state.keys().next().value);
    state.set(key, value);
  };

  ctx.systemPrompt.section({
    name: 'delivery-gate',
    order: 42,
    text: [
      'DELIVERY GATE: the verify tool runs the workspace acceptance script and returns pass/fail with the tail of its output.',
      'If the harness reports that acceptance failed, do not deliver: fix the failure, re-run verify, and only then answer.',
    ].join(' '),
  });


  ctx.effect(() => ctx.on('agent/turn-stopping', async (payload) => {
    if (isOff(resolved)) return;
    const agent = payload && payload.agent;
    if (agent === undefined || agent === null) return;
    if (payload.signal !== undefined && payload.signal.aborted === true) return;
    const cwd = cwdOf(agent, agent.session);
    const script = findScript(cwd, resolved.scripts);
    if (script === null) return;
    const key = sessionKey(agent);
    const prev = state.get(key) || { rounds: 0, last: null, at: 0, inflight: false };
    if (prev.inflight === true) return;
    if (prev.rounds >= resolved.maxRounds) return;
    // 只在「回合内也能收尾」的时机重跑：两次之间至少隔 MIN_GAP_MS，避免同一步里连跑两次
    if (Date.now() - (prev.at || 0) < MIN_GAP_MS) return;
    remember(key, { ...prev, inflight: true });
    let result;
    try {
      result = await runScript(script, cwd, resolved.timeoutMs);
    } finally {
      remember(key, { ...prev, inflight: false, at: Date.now() });
    }
    if (result.ok) {
      remember(key, { rounds: prev.rounds, at: Date.now(), inflight: false, last: { ok: true, code: 0, at: Date.now(), script } });
      log('turn ' + payload.turn + ' acceptance PASS');
      return;
    }
    const rounds = prev.rounds + 1;
    remember(key, { rounds, at: Date.now(), inflight: false, last: { ok: false, code: result.code, at: Date.now(), script } });
    const text = [
      'DELIVERY BLOCKED by the delivery gate: the acceptance script ' + path.relative(cwd, script) + ' exited ' + String(result.code) + ' after ' + result.seconds + ' s.',
      'Tail of its output:',
      '```',
      result.out.slice(-resolved.tailChars),
      '```',
      'Do not report completion. Fix the failing cases (a timeout counts as a failure even when the answers are correct), re-run verify, and only then answer.',
    ].join('\n');
    try {
      agent.steer(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
      log('turn ' + payload.turn + ' acceptance FAIL → steered (round ' + rounds + '/' + resolved.maxRounds + ')');
    } catch (error) {
      log('steer failed: ' + String(error && error.message));
    }
  }));
}
