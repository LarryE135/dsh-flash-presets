#!/usr/bin/env node
/**
 * 批量评测 runner —— 零依赖、跨平台。
 *
 * 对每道 seed 题：临时 DSH_HOME + 临时工作目录 → 在 headless profile 里注入
 * 指定的 flash 预设行（可 --strip-rules 删除若干规则做消融）→ `dsh headless --json`
 * 跑任务 → 解析计费（inputTokens + cacheReadTokens，与 docs/实测证据.md 同口径）
 * → judge.mjs 判分 → 追加一行 CSV。
 *
 *   node bench/run.mjs --list
 *   node bench/run.mjs --dry-run --problem p-prime-gap [--strip-rules 1,4]
 *   node bench/run.mjs --problem p-prime-gap --preset flash-lean-ptc-v3 --arm baseline
 *   node bench/run.mjs --batch --arm baseline                # 全部 seed 题
 *   node bench/run.mjs --batch --strip-rules 4 --arm no-rule4 # 消融：删掉规则 4
 *
 * 需要：PATH 上有 dsh（或 --dsh 指定），以及 DEEPSEEK_API_KEY 环境变量
 * （未设置时 run 会失败在 provider 阶段；--dry-run 与 --list 不需要）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');

const argv = process.argv.slice(2);
const opt = (name, dflt = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const flag = (name) => argv.includes(name);

const listOnly = flag('--list');
const dryRun = flag('--dry-run');
const printPatch = flag('--print-patch');
const batch = flag('--batch');
const problemArg = opt('--problem');
const presetId = opt('--preset', 'flash-lean-ptc-v3');
const arm = opt('--arm', 'baseline');
const stripRules = (opt('--strip-rules') || '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
const dshBin = opt('--dsh', process.env.DSH || 'dsh');
const timeoutMs = Number(opt('--timeout-ms', String(30 * 60 * 1000)));
const outCsv = opt('--out', path.join(repo, 'bench', 'results', 'runs.csv'));
const keepTmp = flag('--keep-tmp');

/** 收集 bench/problems 下所有含 judge.mjs + statement.md 的题目目录。 */
function listProblems() {
  const root = path.join(repo, 'bench', 'problems');
  const found = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, name.name);
      if (name.isDirectory()) {
        if (fs.existsSync(path.join(full, 'judge.mjs')) && fs.existsSync(path.join(full, 'statement.md'))) {
          found.push(full);
        } else {
          walk(full);
        }
      }
    }
  };
  walk(root);
  return found.sort();
}

const problems = listProblems().map((dir) => {
  const limits = JSON.parse(fs.readFileSync(path.join(dir, 'limits.json'), 'utf8'));
  return { id: path.basename(dir), dir, limits };
});

if (listOnly) {
  console.log(`seed 题（${problems.length} 道）：`);
  for (const p of problems) {
    const first = fs.readFileSync(path.join(p.dir, 'statement.md'), 'utf8').split(/\r?\n/).slice(0, 2).join(' ');
    console.log(`  ${p.id}  满分 ${p.limits.maxScore}  时限 ${p.limits.timeLimitMs} ms  ${first}`);
  }
  process.exit(0);
}

const wanted = batch || !problemArg ? problems : problems.filter((p) => p.id === problemArg);
if (wanted.length === 0) {
  console.error(`找不到题目：${problemArg}（--list 列出全部）`);
  process.exit(1);
}
if (!['flash-lean-ptc-v1', 'flash-lean-ptc-v2', 'flash-lean-ptc-v3'].includes(presetId)) {
  console.error('--preset 必须是 flash-lean-ptc-v1 / v2 / v3（当前：' + presetId + '）');
  process.exit(1);
}

/** 从预设源文件取出 insert 块 body（"- insert:\n" 之后的部分）。 */
function presetBody() {
  const src = fs.readFileSync(path.join(repo, 'presets', presetId + '.patch.yml'), 'utf8');
  const m = /^- insert:\n/m.exec(src);
  if (!m) throw new Error('预设文件里找不到 - insert: 条目');
  return src.slice(m.index + m[0].length).replace(/\s+$/, '');
}

/** 删除 persona suffix 里指定编号的规则段（消融）。 */
function stripRuleSegments(body, ids) {
  const m = /(^[ \t]*suffix: \|[\-+]?\n)((?:[ \t]+.*\n?)+)/m.exec(body);
  if (!m) throw new Error('找不到 persona suffix 块');
  const indent = /^[ \t]*/.exec(m[2])[0];
  const lines = m[2].split(/\r?\n/);
  const rule = /^([ \t]*)(\d+)\. /;
  const heading = /^[ \t]*[A-Z][A-Z ]{2,}[ \t]*$/;
  const keep = [];
  let dropping = false;
  for (const line of lines) {
    const r = rule.exec(line);
    const h = heading.exec(line);
    if (r) {
      dropping = ids.includes(Number(r[2]));
      if (!dropping) keep.push(line);
      continue;
    }
    if (dropping) {
      // 到下一个节标题/空行前都丢弃；节标题与空行保留
      if (line.trim() === '' || h) { dropping = false; keep.push(line); }
      continue;
    }
    keep.push(line);
  }
  return body.slice(0, m.index) + m[1] + keep.join('\n').replace(/\s+$/, '\n') + body.slice(m.index + m[0].length);
}

/**
 * 把预设行平铺为 headless 宿主层条目。
 *
 * headless bundle「不构成 preset roster」（其源码注释：model-facing rows sit in the
 * host plane），预设行注入 headless 只会 pending。等价做法：把预设 config.plugins
 * 里的 model-facing 行平铺到宿主层——宿主已有该 id 的写覆盖条目，没有的写 insert；
 * cordis:group 包装行（planning/compaction/delegation）丢弃、其子行提升；
 * disabled:true 的行只在宿主已有该 id 时写覆盖（保持禁用意图）。
 *
 * @param body   预设 insert 块的 body 文本
 * @param hostIds 干净 headless 模板 dump 出的宿主行 id 集合
 */
function buildProfilePatch(body, hostIds) {
  // 收集所有 `- id: X` 行块（含嵌套），返回 [{ indent, header, name, block }]
  const blocks = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([ \t]*)- id: (\S+)/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const block = [lines[i]];
    for (let j = i + 1; j < lines.length; j++) {
      const lm = /^([ \t]*)\S/.exec(lines[j]);
      if (!lm || lm[1].length <= indent) break;
      block.push(lines[j]);
    }
    const name = /name:\s*'?([^'\s]+)'?/.exec(lines[i + 1] || '');
    blocks.push({ indent, id: m[2], name: name ? name[1] : '', block: block.join('\n').replace(/\s+$/, '') });
  }
  const rows = blocks.filter((b) => b.name !== 'cordis:group' && !/^preset-/.test(b.id) && !b.name.includes('dsh-agent-preset'));
  const overrides = [];
  const inserts = [];
  for (const row of rows) {
    const dedented = row.block.split(/\r?\n/).map((l) => l.slice(row.indent)).join('\n');
    const disabled = /disabled:\s*true\b/.test(dedented);
    if (hostIds.has(row.id)) {
      overrides.push(dedented);
    } else if (!disabled) {
      inserts.push(dedented);
    }
  }
  const out = ['# bench 注入：flash 预设的 model-facing 行平铺到 headless 宿主层（由 bench/run.mjs 生成）'];
  for (const o of overrides) out.push(o);
  if (inserts.length > 0) {
    out.push('- insert:');
    for (const ins of inserts) out.push(ins.replace(/^/gm, '  '));
  }
  out.push('');
  return out.join('\n');
}

/** 跨平台执行 dsh：Windows 下 .cmd 需要 cmd /c 包装；参数固定短小、题面走 stdin。 */
function spawnDsh(args, opts = {}) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(dshBin)) {
    // cmd /c 对引号的剥离规则很难伺候：按实测可用的形态——dsh 路径不加引号、参数原样拼接。
    // runner 的固定参数（headless/--json/-/--dump-config/--version）都不含空格；
    // dsh 路径若含空格，请换用无空格路径或 8.3 短路径。
    return spawnSync(process.env.ComSpec || 'cmd', ['/d', '/c', `${dshBin} ${args.join(' ')}`], { ...opts, shell: false });
  }
  return spawnSync(dshBin, args, { ...opts, shell: false });
}

/** 解析 headless --json 的 ndjson 输出。 */
function parseNdjson(stdout) {
  const usage = { inputTokens: 0, cacheReadTokens: 0 };
  let turns = 0;
  let final = '';
  let error = '';
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (!ev || typeof ev !== 'object') continue;
    if (ev.type === 'status' && ev.phase === 'step_end' && ev.usage) {
      usage.inputTokens += Number(ev.usage.inputTokens || 0);
      usage.cacheReadTokens += Number(ev.usage.cacheReadTokens || 0);
    }
    if (ev.type === 'status' && ev.phase === 'turn_end') turns++;
    if (ev.type === 'final' && typeof ev.text === 'string') final = ev.text;
    if (ev.type === 'error') error = String(ev.message || ev.text || 'unknown error').slice(0, 300);
  }
  return { usage, turns, final, error };
}

const CSV_HEADER = 'timestamp,dsh_version,problem,preset,arm,rules_kept,score,max_score,verdict,time_ms,billed_input,billed_cache,wall_ms,turns,final_len,error,log\n';
const csvDir = path.dirname(outCsv);
if (!dryRun) fs.mkdirSync(csvDir, { recursive: true });
if (!dryRun && !fs.existsSync(outCsv)) fs.writeFileSync(outCsv, CSV_HEADER);

const results = [];
// 平铺需要干净 headless 模板的宿主行 id：先 dump 一次（临时 home 里 headless 是 shipped 模板）。
const probeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bench-probe-')) + path.sep + 'home';
fs.mkdirSync(path.join(probeHome, 'profiles', 'headless'), { recursive: true });
const probe = spawnDsh(['headless', '--dump-config'], { env: { ...process.env, DSH_HOME: probeHome }, encoding: 'utf8', timeout: 120000 });
const hostIds = new Set();
for (const line of String(probe.stdout || '').split(/\r?\n/)) {
  const m = /^- id: (\S+)/.exec(line);
  if (m) hostIds.add(m[1]);
}
if (!dryRun && hostIds.size === 0) {
  console.error('✗ 拿不到 headless 模板的宿主行（dump 失败）。' + (probe.error ? ' 无法启动 dsh（' + probe.error.message + '）——用 --dsh <路径> 指定。' : ''));
  console.error(String(probe.stderr || '').slice(-600));
  process.exit(1);
}
if (hostIds.size === 0) {
  console.warn('⚠ 拿不到 headless 模板宿主行（dry-run 下继续，生成的 patch 可能全为 insert）——真实运行请确认 dsh 可用（--dsh <路径>）。');
  console.warn('  probe: exit=' + probe.status + ' error=' + String(probe.error || '') + ' stderr=' + String(probe.stderr || '').slice(-200).replace(/\n/g, ' '));
} else {
  console.log(`headless 模板宿主行：${hostIds.size} 个（${presetId} 的 model-facing 行将平铺其上）`);
}
fs.rmSync(path.dirname(probeHome), { recursive: true, force: true });

const dshVersionProbe = spawnDsh(['--version'], { encoding: 'utf8', timeout: 30000 });
const dshVersion = (dshVersionProbe.stdout || '').trim().split(/\s+/)[0] || '';

const presetBodyText = stripRules.length > 0 ? stripRuleSegments(presetBody(), stripRules) : presetBody();

for (const problem of wanted) {
  const prompt = fs.readFileSync(path.join(problem.dir, 'statement.md'), 'utf8');
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), `dsh-bench-${problem.id}-`)) + path.sep + 'ws';
  const home = path.join(path.dirname(workdir), 'home');
  fs.mkdirSync(workdir, { recursive: true });
  fs.mkdirSync(path.join(home, 'profiles', 'headless'), { recursive: true });

  // 复制题目输入材料（data/、input.json 等）
  for (const name of fs.readdirSync(problem.dir)) {
    if (name === 'judge.mjs' || name === 'statement.md' || name === 'limits.json') continue;
    const src = path.join(problem.dir, name);
    if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(workdir, name));
    else fs.cpSync(src, path.join(workdir, name), { recursive: true });
  }

  const profilePatch = path.join(home, 'profiles', 'headless', 'cordis.patch.yml');
  const patchText = buildProfilePatch(presetBodyText, hostIds);
  if (printPatch) {
    console.log('--- profile patch（平铺到 headless 宿主层的 cordis.patch.yml）---');
    console.log(patchText);
    console.log('----------------------------------------------');
  }
  fs.writeFileSync(profilePatch, patchText);
  const judgeCmd = [process.execPath, path.join(problem.dir, 'judge.mjs'), workdir];
  // 题面经 stdin 传入（headless 的 task 为 '-' 时读 stdin），避免命令行转义问题。
  const dshArgs = ['headless', '--json', '-'];
  const logFile = path.join(path.dirname(workdir), 'dsh.log');

  console.log(`\n== ${problem.id}（preset=${presetId} arm=${arm}${stripRules.length ? ' 消融删规则 ' + stripRules.join(',') : ''}）==`);
  console.log('   workdir: ' + (keepTmp ? workdir : workdir + '（跑完删除）'));
  console.log('   dsh: ' + dshBin + ' ' + dshArgs.join(' ') + ' <stdin: prompt ' + prompt.length + ' chars>');

  if (dryRun) {
    console.log('   judge: node ' + judgeCmd.slice(1).join(' '));
    console.log('   （--dry-run：未实际执行）');
    continue;
  }

  const t0 = Date.now();
  const run = spawnDsh(dshArgs, {
    cwd: workdir,
    env: { ...process.env, DSH_HOME: home },
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    input: prompt,
  });
  const wallMs = Date.now() - t0;
  fs.writeFileSync(logFile, '--- stdout ---\n' + (run.stdout || '') + '\n--- stderr ---\n' + (run.stderr || ''));

  const parsed = parseNdjson(run.stdout);
  let judged = { score: 0, maxScore: problem.limits.maxScore, verdict: 'NOJUDGE', timeMs: 0, peakMemMB: undefined, detail: 'dsh 未产出可判分的运行' };
  if (!run.error && !run.signal) {
    const j = spawnSync(judgeCmd[0], judgeCmd.slice(1), { encoding: 'utf8', timeout: 60000 });
    try { judged = JSON.parse((j.stdout || '').trim() || '{}'); } catch { judged.detail = 'judge 输出非 JSON: ' + String(j.stdout).slice(0, 120); }
  }

  const row = {
    timestamp: new Date().toISOString(),
    dsh_version: dshVersion,
    problem: problem.id,
    preset: presetId,
    arm,
    rules_kept: stripRules.length ? 'minus-' + stripRules.join('.') : 'all',
    score: judged.score,
    max_score: judged.maxScore,
    verdict: judged.verdict,
    time_ms: judged.timeMs,
    billed_input: parsed.usage.inputTokens,
    billed_cache: parsed.usage.cacheReadTokens,
    wall_ms: wallMs,
    turns: parsed.turns,
    final_len: parsed.final.length,
    error: (run.error ? 'dsh 启动失败: ' + run.error.message : run.signal ? 'dsh 超时/被杀: ' + run.signal : parsed.error || judged.detail || ''),
    log: keepTmp ? logFile : '',
  };
  results.push(row);
  const csvLine = Object.values(row).map((v) => {
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',') + '\n';
  fs.appendFileSync(outCsv, csvLine);
  console.log(`   判分 ${judged.score}/${judged.maxScore} ${judged.verdict} | 计费输入 ${parsed.usage.inputTokens}（cache ${parsed.usage.cacheReadTokens}）| 轮数 ${parsed.turns} | 墙钟 ${wallMs} ms`);

  if (!keepTmp) fs.rmSync(path.dirname(workdir), { recursive: true, force: true });
}

if (!dryRun && results.length > 0) {
  console.log(`\n已追加 ${results.length} 行到 ${outCsv}`);
}
