#!/usr/bin/env node
/**
 * 兼容性审计（只读）：回答「哪些会话在升级后会打不开」。
 *
 * 判定依据是 DSH 自己的解析语义，不是 header：
 *   header.agentPreset 只是投影的初值，随后每个 agent-preset/selected 事件都会覆盖它；
 *   resume 走 presetForObservation() → agentPresets.resolve(id)，取的是**最后一条事件的值**。
 * 所以「有效 preset = 日志里最后一条 agent-preset/selected，没有就用 header」，
 * 只扫 header 会把“header 已修好、事件里还写着旧 id”的会话误判成健康（0.2.8 的误判就是这样来的）。
 *
 *   node scripts/audit-compat.mjs                     # 用 ~/.dsh
 *   node scripts/audit-compat.mjs --dsh-home /mnt/c/Users/X/.dsh
 *   node scripts/audit-compat.mjs --json
 *   node scripts/audit-compat.mjs --limit 20          # 每类列出的样本数
 *
 * 退出码：存在「孤儿 id」（既不在 roster、也不在 alias 表）时为 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { runDsh, resolveDsh, tryDshVersion } from './lib/run-dsh.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback; };
const HOME = arg('--dsh-home', process.env.DSH_HOME || path.join(os.homedir(), '.dsh'));
const AS_JSON = argv.includes('--json');
const LIMIT = Number(arg('--limit', '8')) || 8;
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
// 上游 web 组合包自带的常驻预设（dsh --profile web --dump-config 可核对）
const BUILTIN = new Set(['standard', 'minimal', 'ptc', 'cordis']);

function frameOffsets(buf) {
  const out = [];
  let i = buf.indexOf(MAGIC, 0);
  while (i !== -1) { out.push(i); i = buf.indexOf(MAGIC, i + 4); }
  return out;
}
function decodeFrames(buf) {
  const offs = frameOffsets(buf);
  const frames = [];
  for (let k = 0; k < offs.length; k++) {
    const end = k + 1 < offs.length ? offs[k + 1] : buf.length;
    try { frames.push(zlib.zstdDecompressSync(buf.subarray(offs[k], end)).toString('utf8')); }
    catch {
      try { frames.push(zlib.zstdDecompressSync(buf.subarray(offs[k])).toString('utf8')); }
      catch { frames.push(null); }
    }
  }
  return frames;
}

function aliasMap() {
  const file = path.join(repo, 'presets', 'legacy-preset-map.json');
  if (!fs.existsSync(file)) return { canonical: null, aliases: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const aliases = parsed && typeof parsed.aliases === 'object' && parsed.aliases !== null ? parsed.aliases : {};
    return { canonical: parsed && parsed.canonical, aliases };
  } catch { return { canonical: null, aliases: {} }; }
}

// roster 的权威来源是 DSH 自己合成的配置：dsh --profile <p> --dump-config。
// 只扫目录里的 yml 是不可靠的——profiles/ 下还有别的 profile（acp 等）和一堆 .bak-*，
// 曾经因此把 codex-contract-v1 / -v2 误判成“已定义”，掩盖了 117 个打不开的会话。
function rosterFromDump(text) {
  const ids = new Set();
  const lines = text.split('\n');
  let name = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const entry = /^- id: (.+)$/.exec(line);
    if (entry) { name = null; continue; }
    const nameRow = /^  name: '([^']+)'$/.exec(line);
    if (nameRow) { name = nameRow[1]; continue; }
    if (name === '@deepseek-ai/dsh-agent-preset') {
      const idRow = /^    id: (.+)$/.exec(line);
      if (idRow && !/^(plugins|config):$/.test(line)) { ids.add(idRow[1].trim()); name = null; }
    }
  }
  return ids;
}

function rosterFromProfileDir(profileName) {
  const ids = new Set(BUILTIN);
  const roots = [];
  const dir = path.join(HOME, 'profiles', profileName);
  if (fs.existsSync(dir)) roots.push(dir, path.join(dir, 'node_modules', 'dsh-flash-presets'), path.join(dir, 'plugins'));
  const scan = (dir, depth) => {
    if (depth > 4 || !fs.existsSync(dir)) return;
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 4) scan(p, depth + 1); continue; }
      if (!/\.ya?ml$/.test(e.name)) continue;
      if (/\.bak|disabled|archive|\.removed/.test(e.name) || /\.bak|disabled|archive|\.removed/.test(p)) continue;
      let text = ''; try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
      for (const m of text.matchAll(/^\s*(?:- )?id: (flash-lean[\w-]*|light-ptc[\w-]*|codex-contract-v[0-9]+|win-control|code)\s*$/gm)) ids.add(m[1]);
    }
  };
  for (const r of roots) scan(r, 0);
  return ids;
}

function rosterIds() {
  const dumpFile = arg('--dump', null);
  if (dumpFile !== null && fs.existsSync(dumpFile)) return { ids: rosterFromDump(fs.readFileSync(dumpFile, 'utf8')), source: 'dump:' + dumpFile };
  const profile = arg('--profile', 'web');
  try {
    const out = runDsh( ['--profile', profile, '--dump-config'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 180000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, DSH_HOME: HOME } });
    const ids = rosterFromDump(out);
    if (ids.size > 0) return { ids, source: 'dsh --profile ' + profile + ' --dump-config' };
  } catch (error) { /* 退回目录扫描 */ }
  return { ids: rosterFromProfileDir(profile), source: 'profiles/' + profile + ' 目录扫描（best-effort）' };
}

const roster = rosterIds();
const defined = roster.ids;
const map = aliasMap();

// 别名层只在插件卡形态里存在（组合包自带那一行 flash-presets-alias）。脚本安装（install.sh 写的托管块）没有这一行，
// 所以「在 alias 表里」不等于「这台机器上打得开」（第六轮 U1-3）。
function aliasLayerInstalled() {
  if (argv.includes('--no-alias')) return false;
  if (argv.includes('--alias-layer')) return true;
  const prof = arg('--profile', 'web');
  const pj = path.join(HOME, 'profiles', prof, 'package.json');
  try {
    const j = JSON.parse(fs.readFileSync(pj, 'utf8'));
    const bundles = (j.dsh && j.dsh.profile && j.dsh.profile.bundles) || [];
    if (bundles.includes('dsh-flash-presets')) return true;
  } catch { /* 没有 profile 清单就继续探 */ }
  return fs.existsSync(path.join(HOME, 'profiles', prof, 'node_modules', 'dsh-flash-presets', 'lib', 'alias-plugin.js'));
}
const aliasLayer = aliasLayerInstalled();
const rows = [];
const damaged = [];
let files = 0;

function walk(dir) {
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/^session(\.[vV]\d+)?\.jsonl(\.zstd)?$/.test(e.name)) continue;
    files++;
    const st = fs.statSync(p);
    const buf = fs.readFileSync(p);
    const isZstd = buf.length >= 4 && buf.readUInt32LE(0) === 0xfd2fb528;
    let lines = [];
    let firstFrameLines = 0;
    if (isZstd) {
      const frames = decodeFrames(buf);
      if (frames.some((f) => f === null)) damaged.push({ file: p, issue: 'undecodable-frame' });
      firstFrameLines = (frames[0] || '').split('\n').filter(Boolean).length;
      lines = frames.filter((f) => typeof f === 'string').join('').split('\n').filter(Boolean);
    } else {
      lines = buf.toString('utf8').split('\n').filter(Boolean);
      firstFrameLines = 1;
    }
    if (lines.length === 0) { damaged.push({ file: p, issue: 'empty' }); continue; }
    let header = null;
    try { header = JSON.parse(lines[0]); } catch { damaged.push({ file: p, issue: 'bad-header' }); continue; }
    if (firstFrameLines > 1) damaged.push({ file: p, issue: 'first-frame-has-events(' + firstFrameLines + ')' });
    let last = null;
    let title = null;
    let firstUser = null;
    for (let i = 1; i < lines.length; i++) {
      let ev; try { ev = JSON.parse(lines[i]); } catch { continue; }
      if (ev.type === 'agent-preset/selected') last = ev.data && ev.data.agentPreset;
      if (ev.type === 'session/title') title = (ev.data && (ev.data.title || ev.data.text)) || title;
      if (firstUser === null && (ev.type === 'user/message' || ev.type === 'message/user')) {
        const c = ev.data && (ev.data.text || ev.data.content);
        if (typeof c === 'string') firstUser = c.replace(/\s+/g, ' ').slice(0, 60);
      }
    }
    const headerPreset = typeof header.agentPreset === 'string' ? header.agentPreset : null;
    const effective = last !== null && last !== undefined ? last : headerPreset;
    rows.push({
      id: header.id,
      file: p,
      project: path.basename(path.dirname(path.dirname(p))),
      events: lines.length - 1,
      kb: Math.round(st.size / 1024),
      date: new Date(st.mtimeMs).toISOString().slice(0, 10),
      headerPreset,
      lastSelection: last,
      effective,
      title: title || firstUser || '',
    });
  }
}
const sessionsRoot = path.join(HOME, 'sessions');
if (fs.existsSync(sessionsRoot)) walk(sessionsRoot);

const buckets = { none: [], defined: [], aliased: [], unresolved: [], orphan: [] };
for (const r of rows) {
  if (r.effective === null) { buckets.none.push(r); continue; }
  if (defined.has(r.effective)) { buckets.defined.push(r); continue; }
  if (Object.prototype.hasOwnProperty.call(map.aliases, r.effective)) {
    (aliasLayer ? buckets.aliased : buckets.unresolved).push(r);
    continue;
  }
  buckets.orphan.push(r);
}
const groupBy = (list) => {
  const out = {};
  for (const r of list) { const k = r.effective; out[k] = (out[k] || 0) + 1; }
  return out;
};
const headerVsEffective = rows.filter((r) => r.headerPreset !== r.effective).length;
const result = {
  home: HOME,
  sessionFiles: files,
  roster: [...defined].sort(),
  rosterSource: roster.source,
  aliasCanonical: map.canonical,
  aliasIds: Object.keys(map.aliases).sort(),
  counts: { none: buckets.none.length, defined: buckets.defined.length, aliased: buckets.aliased.length, unresolved: buckets.unresolved.length, orphan: buckets.orphan.length },
  aliasLayer,
  headerVsEffectiveMismatch: headerVsEffective,
  aliasedBy: groupBy(buckets.aliased),
  unresolvedBy: groupBy(buckets.unresolved),
  orphanBy: groupBy(buckets.orphan),
  orphanSessions: buckets.orphan.sort((a, b) => b.events - a.events).slice(0, LIMIT),
  damaged: damaged.slice(0, LIMIT),
  damagedCount: damaged.length,
};

if (AS_JSON) {
  console.log(JSON.stringify(result, null, 1));
} else {
  console.log('DSH home：' + HOME);
  console.log('会话文件：' + files + '（首帧 header 不再是唯一依据：有效 preset = 最后一条 agent-preset/selected，否则 header）');
  console.log('roster（来源：' + roster.source + '）：' + [...defined].sort().join(', '));
  console.log('alias 表：' + Object.keys(map.aliases).length + ' 个历史 id → ' + map.canonical);
  console.log('分布：' + JSON.stringify(result.counts) + '   header≠有效 preset：' + headerVsEffective);
  if (Object.keys(result.aliasedBy).length) console.log('经 alias 层可解析：' + JSON.stringify(result.aliasedBy));
  if (Object.keys(result.unresolvedBy).length) {
    console.log('✖ 本形态没有别名层（没装插件卡，或用了 --no-alias），这些历史 id 此时解析不到：' + JSON.stringify(result.unresolvedBy));
    console.log('   修法：改装插件卡（自带 flash-presets-alias 行），或在 profile 补丁里加回原预设行；本包不改写任何会话文件。');
  }
  if (buckets.orphan.length) {
    console.log('');
    console.log('✖ 孤儿 id（既不在 roster 也不在 alias 表 → 这些会话一定打不开）：' + JSON.stringify(result.orphanBy));
    for (const r of result.orphanSessions) {
      console.log('   ' + r.effective + ' | ' + r.events + 'ev | ' + r.kb + 'KB | ' + r.date + ' | ' + r.project + ' | ' + r.title);
    }
    console.log('   修法：把 id 加进 presets/legacy-preset-map.json（不动会话文件），或跑 scripts/retarget-session-presets.mjs 一次性迁移。');
  } else {
    console.log('✓ 没有孤儿 id：全部会话的 preset 都能解析');
  }
  if (damaged.length) {
    console.log('✖ 结构可疑会话：' + damaged.length);
    for (const d of result.damaged) console.log('   ' + d.issue + '  ' + d.file.replace(HOME, '~/.dsh'));
  } else {
    console.log('✓ 首帧单行 header、帧链可解');
  }
}
process.exit(buckets.orphan.length || buckets.unresolved.length || damaged.length ? 1 : 0);
