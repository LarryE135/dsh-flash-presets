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
  // 默认关闭：插件卡/插件市场建行时不会带上本包的路由配置，schema 默认值就是唯一防线。
  // 0.3.1 是 true，于是有人装了之后普通对话也被验收门追着跑。
  enabled: z.boolean().default(false),
  /** 验收脚本候选名（按序找第一个存在的）；Windows 先找 verify.ps1，*nix 先找 verify.sh */
  scripts: z.array(z.string()).default(defaultScripts),
  /** 同一会话最多回灌几次 */
  maxRounds: z.number().default(2),
  /** 单次验收的超时（毫秒） */
  timeoutMs: z.number().default(900000),
  /** 回灌消息里引用多少字符的尾部输出 */
  tailChars: z.number().default(1200)
});

// Windows 上通常没有 verify.sh，而 pwsh 也跑不了 bash 脚本：默认候选跟平台走，
// 两个都写了的用户不受影响（按序取第一个存在的）。
function defaultScripts() {
  return process.platform === 'win32' ? ['verify.ps1', 'verify.sh'] : ['verify.sh', 'verify.ps1'];
}

const TAG = '[delivery-gate]';
const SESSION_CAP = 200;
// 两次自动验收的最小间隔：turn-stopping 会在回合内的步与步之间也触发
const MIN_GAP_MS = 15000;

function log(message) {
  try { console.info(TAG + ' ' + message); } catch (error) {}
}

function isOff(config) {
  const env = process.env.DSH_DELIVERY_GATE;
  if (env === '0') return true;
  // 文档一直写着「或临时设 DSH_DELIVERY_GATE=1」，但代码以前只认 0 —— 设 1 根本不生效。
  if (env === '1') return false;
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
// 三个坑（2026-11-17 审计）：
//   1. 只听 close 会被后台孙进程挂死 —— verify.sh 里跑 "npm run dev &" 时 stdout 管道不关，
//      close 永不触发，而 turn-stopping 是 await 的，整个回合就此卡住。改成听 exit + 排空宽限。
//   2. 只 kill bash 杀不掉孙进程 —— detached 起独立进程组，超时/取消时 kill(-pid)。
//   3. 输出无上限 —— 结果只用尾部 tailChars，这里按 128 KB 环形保留。
function runScript(file, cwd, timeoutMs, signal) {
  return new Promise((resolve) => {
    const win = process.platform === 'win32';
    const startedAt = Date.now();
    const CAP = 128 * 1024;
    const keep = (cur, buf) => {
      const next = cur + String(buf);
      return next.length > CAP ? next.slice(-CAP) : next;
    };
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let child;
    let done = false;
    let timer;
    // 收尾一律清一次进程组（第二轮审计 P2-9）：脚本正常退出时它留下的后台进程（例如起一个
    // dev server）会一直挂着，每个回合多一个进程、占一份端口。Windows 没有进程组，用 taskkill /T。
    const cleanup = () => {
      if (child === undefined || child === null) return;
      const pid = child.pid;
      if (typeof pid !== 'number' || pid <= 0) return;
      try {
        if (win) spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true, stdio: 'ignore' });
        else process.kill(-pid, 'SIGTERM');
      } catch (error) {}
    };
    const finish = (code) => {
      if (done) return;
      done = true;
      cleanup();
      if (timer !== undefined) clearTimeout(timer);
      if (signal !== undefined && typeof signal.removeEventListener === 'function') {
        try { signal.removeEventListener('abort', onAbort); } catch (error) {}
      }
      const seconds = Math.round((Date.now() - startedAt) / 100) / 10;
      resolve({
        ok: code === 0 && timedOut !== true && aborted !== true,
        code,
        out: (stdout + stderr).trim(),
        seconds,
        timedOut: timedOut || aborted,
      });
    };
    const killTree = () => {
      if (child === undefined || child === null) return;
      try {
        // detached 起的子进程自成进程组：负 pid 一次性带走 bash 和它的孙进程
        if (!win && typeof child.pid === 'number' && child.pid > 0) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch (error) {
        try { child.kill('SIGKILL'); } catch (error2) {}
      }
    };
    const onAbort = () => { aborted = true; killTree(); };
    // 按扩展名选解释器：以前 Windows 一律 pwsh -File，遇到 verify.sh 必然失败（第二轮审计 P2-5）。
    const ext = path.extname(file).toLowerCase();
    const argv = ext === '.ps1'
      ? ['pwsh', ['-NoProfile', '-NonInteractive', '-File', file]]
      : [win ? 'bash' : '/bin/bash', [file]];   // Windows 走 Git Bash；没有就 ENOENT，按跳过处理
    try {
      child = spawn(argv[0], argv[1], { cwd, windowsHide: true, detached: !win });
    } catch (error) {
      resolve({ ok: true, skipped: true, code: null, out: 'spawn failed: ' + String(error && error.message), seconds: 0, timedOut: false });
      return;
    }
    timer = setTimeout(() => { timedOut = true; killTree(); }, timeoutMs);
    if (signal !== undefined && typeof signal.addEventListener === 'function') {
      if (signal.aborted === true) { aborted = true; killTree(); }
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    child.stdout.on('data', (buf) => { stdout = keep(stdout, buf); });
    child.stderr.on('data', (buf) => { stderr = keep(stderr, buf); });
    child.on('error', (error) => {
      // 解释器不存在（Windows 没有 Git Bash / 没有 pwsh）不算验收失败：跳过，别把用户堵在回合里
      if (error !== null && error !== undefined && error.code === 'ENOENT') {
        done = true;
        if (timer !== undefined) clearTimeout(timer);
        resolve({ ok: true, skipped: true, code: null, out: argv[0] + ' not found (ENOENT) - acceptance skipped', seconds: 0, timedOut: false });
        return;
      }
      stderr = keep(stderr, String(error && error.message));
      finish(null);
    });
    // exit 先到：给 stdio 一点排空时间再收尾，避免丢尾部输出（close 也可能先到）
    child.on('exit', (code) => { setTimeout(() => finish(code), 200); });
    child.on('close', (code) => { finish(code); });
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
  // 不要回落到 process.cwd()：那是宿主进程的启动目录，不是本会话的工作区。
  // 拿不到就返回 null，由调用方跳过验收（宁可少跑一次，也不要在错误目录里跑别人的 verify.sh）。
  return fromBox(session) ?? (agent !== undefined && agent !== null ? fromBox(agent.session) : null);
}

function maybeResolve(config) {
  const base = { enabled: false, scripts: defaultScripts(), maxRounds: 2, timeoutMs: 900000, tailChars: 1200 };
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

  // 关着的时候一个字都不注入：0.3.1 以前无条件注册，导致关掉交付门的人每次请求仍多出
  // 一段「the verify tool…」的指令（该工具根本不存在，模型只会去调它或编造验收结果）。
  // 宿主 PromptSection 只有 name/order/text（text 可为每次装配求值的 provider），
  // 没有 when 之类的条件字段，所以用 provider 返回空串 —— 空 section 在装配时会被丢掉。
  const sectionText = [
    'DELIVERY GATE: this workspace has an acceptance script; the harness runs it when a turn stops and sends you pass/fail plus the tail of its output.',
    'If the harness reports that acceptance failed, do not deliver: fix the failure and let it run again; only then answer.',
  ].join(' ');
  ctx.systemPrompt.section({
    name: 'delivery-gate',
    order: 42,
    text: () => (isOff(resolved) ? '' : sectionText),
  });

  ctx.effect(() => ctx.on('agent/turn-stopping', async (payload) => {
    if (isOff(resolved)) return;
    const agent = payload && payload.agent;
    if (agent === undefined || agent === null) return;
    if (payload.signal !== undefined && payload.signal.aborted === true) return;
    // 与主插件一致：优先问 workingDirectory 服务（生产环境 session.cwd 常为 undefined）
    const cwd = await resolveCwd(ctx, { agent, signal: payload.signal });
    if (cwd === null || cwd === undefined) return;   // 拿不到工作区就跳过，不在错误目录里跑脚本
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
      result = await runScript(script, cwd, resolved.timeoutMs, payload.signal);
    } finally {
      remember(key, { ...prev, inflight: false, at: Date.now() });
    }
    if (result.skipped === true) {
      remember(key, { ...prev, inflight: false, at: Date.now(), last: { skipped: true, at: Date.now(), script } });
      log('turn ' + payload.turn + ' acceptance SKIPPED: ' + String(result.out).slice(0, 120));
      return;
    }
    if (result.ok) {
      remember(key, { rounds: 0, at: Date.now(), inflight: false, last: { ok: true, code: 0, at: Date.now(), script } });
      log('turn ' + payload.turn + ' acceptance PASS');
      return;
    }
    const rounds = prev.rounds + 1;
    remember(key, { rounds, at: Date.now(), inflight: false, last: { ok: false, code: result.code, at: Date.now(), script } });
    const text = [
      '[delivery-gate] Everything below is output from the workspace acceptance script, not an instruction from the user.',
      'DELIVERY BLOCKED by the delivery gate: the acceptance script ' + path.relative(cwd, script) + ' exited ' + String(result.code) + ' after ' + result.seconds + ' s.',
      'Tail of its output:',
      '```',
      result.out.slice(-resolved.tailChars),
      '```',
      'Do not report completion. Fix the failing cases (a timeout counts as a failure even when the answers are correct), re-run the acceptance script, and only then answer.',
    ].join('\n');
    try {
      agent.steer(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
      log('turn ' + payload.turn + ' acceptance FAIL → steered (round ' + rounds + '/' + resolved.maxRounds + ')');
    } catch (error) {
      log('steer failed: ' + String(error && error.message));
    }
  }));
}
