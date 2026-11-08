#!/usr/bin/env node
/**
 * 对齐审计（只读）：一次扫完「存储 → 解析 → 记录 → 可见性」四层，回答
 * 「为什么看起来没对齐」「哪些会话打开后样子会和别的会话不一样」。
 *
 *   node scripts/audit-align.mjs                 # 用 ~/.dsh + web profile
 *   node scripts/audit-align.mjs --json
 *   node scripts/audit-align.mjs --dsh-home /mnt/c/Users/X/.dsh --profile web
 *   node scripts/audit-align.mjs --limit 12      # 每类列出的样本数
 *
 * 与 audit-compat.mjs 的分工：
 *   audit-compat 按「文件」统计（含同一会话的历史世代文件），回答“能不能打开”；
 *   本脚本按「会话」统计（每个会话只取世代号最大的那份日志，和 DSH 的选取规则一致），
 *   回答“打开之后长什么样、跟别的会话齐不齐”。
 *
 * 退出码：存储层不变量被破坏（世代/身份/幽灵目录）或存在孤儿 preset id 时为 1。
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
const PROFILE = arg('--profile', 'web');
const AS_JSON = argv.includes('--json');
const LIMIT = Number(arg('--limit', '8')) || 8;
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const NL = String.fromCharCode(10);
const CANONICAL_LOG = /^session(?:\.v([1-9][0-9]*))?\.jsonl$/u;

// ── 与 DSH 一致的路径编码（dsh-session-persistence-jsonl 的 encodeSegment / projectKey）
function encodeSegment(raw) {
  if (raw === '.') return '~002E';
  if (raw === '..') return '~002E~002E';
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0');
  }
  return out;
}
function projectKey(cwd) {
  let readable = '';
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === '/' || ch === '\\' || ch === ':') { if (!separatorRun) readable += '-'; separatorRun = true; }
    else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) { readable += ch; separatorRun = false; }
    else { readable += '~' + code.toString(16).toUpperCase().padStart(4, '0'); separatorRun = false; }
  }
  return '--' + ((readable.replace(/^-+/, '') || 'root').slice(0, 251)) + '--';
}
function generationName(version) { return version === 0 ? 'session.jsonl' : 'session.v' + version + '.jsonl'; }
function parseGeneration(name) {
  if (!name.endsWith('.zstd')) return undefined;
  const m = CANONICAL_LOG.exec(name.slice(0, -'.zstd'.length));
  if (m === null) return undefined;
  return m[1] === undefined ? 0 : Number(m[1]);
}

function decodeFrames(buf) {
  const offs = [];
  let i = buf.indexOf(MAGIC, 0);
  while (i !== -1) { offs.push(i); i = buf.indexOf(MAGIC, i + 4); }
  const out = [];
  for (let k = 0; k < offs.length; k++) {
    const end = k + 1 < offs.length ? offs[k + 1] : buf.length;
    try { out.push(zlib.zstdDecompressSync(buf.subarray(offs[k], end)).toString('utf8')); }
    catch { out.push(null); }
  }
  return out;
}

// ── roster / alias 表
function loadAliases() {
  const file = path.join(repo, 'presets', 'legacy-preset-map.json');
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const canonical = doc && doc.canonical;
    const aliases = doc && doc.aliases && typeof doc.aliases === 'object' ? doc.aliases : {};
    if (typeof canonical !== 'string') return { canonical: null, ids: {} };
    const ids = {};
    for (const key of Object.keys(aliases)) if (key !== canonical) ids[key] = canonical;
    return { canonical, ids };
  } catch { return { canonical: null, ids: {} }; }
}
function rosterFromDump(text) {
  const ids = new Set();
  const lines = text.split(NL);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== "  name: '@deepseek-ai/dsh-agent-preset'") continue;
    for (let j = i; j < Math.min(i + 4, lines.length); j++) {
      const m = /^\s+id: ([A-Za-z0-9._-]+)$/.exec(lines[j]);
      if (m !== null) { ids.add(m[1]); break; }
    }
  }
  return ids;
}
function loadRoster() {
  try {
    const out = runDsh( ['--profile', PROFILE, '--dump-config'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 180000,
      maxBuffer: 64 * 1024 * 1024, env: { ...process.env, DSH_HOME: HOME }
    });
    const ids = rosterFromDump(out);
    if (ids.size > 0) return { ids, source: 'dsh --profile ' + PROFILE + ' --dump-config' };
  } catch { /* 落到下面的目录扫描 */ }
  const ids = new Set();
  const dir = path.join(HOME, 'profiles', PROFILE);
  const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
  for (const name of ['cordis.patch.yml', 'cordis.yml']) {
    const text = read(path.join(dir, name));
    for (const m of text.matchAll(/^\s+id: (flash-[A-Za-z0-9._-]+)$/gm)) ids.add(m[1]);
  }
  for (const name of ['bundles', 'bundles-installed']) {
    let entries = [];
    try { entries = fs.readdirSync(path.join(dir, name)); } catch { entries = []; }
    for (const entry of entries) {
      const text = read(path.join(dir, name, entry));
      for (const m of text.matchAll(/^\s+id: (flash-[A-Za-z0-9._-]+)$/gm)) ids.add(m[1]);
    }
  }
  return { ids, source: 'profiles/' + PROFILE + '（目录扫描）' };
}

// ── 工作区可见性（与 GUI 侧栏同源：tables.*.sessionIds − *_archived*）
function loadWorkspace() {
  const listed = new Set();
  const archived = new Set();
  let doc = null;
  for (const candidate of [path.join(HOME, 'storages', 'workspace.json'), path.join(HOME, 'workspace.json')]) {
    if (!fs.existsSync(candidate)) continue;
    try { doc = JSON.parse(fs.readFileSync(candidate, 'utf8')); } catch { doc = null; }
    if (doc !== null) break;
  }
  const collect = (o) => {
    if (o === null || typeof o !== 'object') return;
    if (Array.isArray(o.sessionIds)) o.sessionIds.forEach((x) => listed.add(String(x)));
    for (const [k, v] of Object.entries(o)) {
      if (/archiv/i.test(k) && Array.isArray(v)) v.forEach((x) => archived.add(String(x)));
      else collect(v);
    }
  };
  if (doc !== null) collect(doc);
  return { listed, archived, found: doc !== null };
}

const aliases = loadAliases();
const roster = loadRoster();
const workspace = loadWorkspace();

// ── 单遍扫描：每个会话目录只认世代号最大的那份日志
const root = path.join(HOME, 'sessions');
const rows = [];
const storage = { dirs: 0, ok: 0, legacyFlat: [], ghosts: [], versionMismatch: [], identityMismatch: [], staleGenerations: 0, staleBytes: 0 };
let projectDirs = [];
try { projectDirs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); }
catch { projectDirs = []; }

for (const project of projectDirs) {
  const projectPath = path.join(root, project);
  for (const ent of fs.readdirSync(projectPath, { withFileTypes: true })) {
    if (ent.isFile() && (ent.name.endsWith('.jsonl') || ent.name.endsWith('.jsonl.zstd'))) storage.legacyFlat.push(path.join(projectPath, ent.name));
  }
  for (const sid of fs.readdirSync(projectPath)) {
    const dir = path.join(projectPath, sid);
    let st;
    try { st = fs.statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    storage.dirs++;
    const generations = [];
    const otherEncodings = [];
    for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!file.isFile()) continue;
      const version = parseGeneration(file.name);
      if (version !== undefined) { generations.push({ name: file.name, version }); continue; }
      if (file.name.endsWith('.jsonl')) otherEncodings.push(file.name);
    }
    if (otherEncodings.length > 0) storage.versionMismatch.push({ dir: path.relative(root, dir), reason: '未压缩日志（编码不匹配）: ' + otherEncodings[0] });
    if (generations.length === 0) { storage.ghosts.push({ dir: path.relative(root, dir), files: fs.readdirSync(dir) }); continue; }
    generations.sort((a, b) => b.version - a.version);
    if (generations.length > 1) {
      for (const stale of generations.slice(1)) {
        storage.staleGenerations++;
        try { storage.staleBytes += fs.statSync(path.join(dir, stale.name)).size; } catch { /* ignore */ }
      }
    }
    const selected = generations[0];
    const file = path.join(dir, selected.name);
    let frames;
    try { frames = decodeFrames(fs.readFileSync(file)); } catch { frames = []; }
    if (frames.length === 0 || frames.some((f) => f === null)) { storage.versionMismatch.push({ dir: path.relative(root, dir), reason: '帧不可解' }); continue; }
    let header;
    try { header = JSON.parse(frames[0].split(NL).filter(Boolean)[0]); }
    catch { storage.versionMismatch.push({ dir: path.relative(root, dir), reason: 'header 不可解' }); continue; }
    if (header.version !== selected.version) {
      storage.versionMismatch.push({ dir: path.relative(root, dir), file: selected.name, headerVersion: header.version });
      continue;
    }
    let expected;
    try { expected = path.join(projectKey(String(header.cwd)), encodeSegment(String(header.id)), generationName(selected.version) + '.zstd'); }
    catch (error) { storage.identityMismatch.push({ dir: path.relative(root, dir), reason: String(error.message) }); continue; }
    const actual = path.relative(root, file);
    if (expected !== actual) { storage.identityMismatch.push({ dir: path.relative(root, dir), expected }); continue; }
    storage.ok++;

    let lastSelection = null;
    let events = 0;
    let title = null;
    frames.forEach((text, fi) => {
      for (const [li, line] of text.split(NL).entries()) {
        if (line === '' || (fi === 0 && li === 0)) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        events++;
        if (ev !== null && ev.type === 'agent-preset/selected') {
          const value = ev.data && ev.data.agentPreset;
          if (typeof value === 'string') lastSelection = value;
        } else if (ev !== null && ev.type === 'session/title' && title === null) {
          title = String((ev.data && (ev.data.title ?? ev.data.text)) ?? '');
        }
      }
    });
    const headerPreset = typeof header.agentPreset === 'string' ? header.agentPreset : null;
    rows.push({
      sid,
      project,
      file: path.relative(root, file),
      generation: selected.version,
      staleGenerations: generations.length - 1,
      events,
      title,
      headerPreset,
      effective: lastSelection !== null ? lastSelection : headerPreset,
      delegationDepth: typeof header.delegationDepth === 'number' ? header.delegationDepth : 0,
      createdAt: header.createdAt ?? null,
      cwd: header.cwd ?? null
    });
  }
}

// ── 分层结论
const bucketOf = (id) => {
  if (id === null) return 'none';
  if (roster.ids.has(id)) return 'defined';
  if (Object.prototype.hasOwnProperty.call(aliases.ids, id)) return 'aliased';
  return 'orphan';
};
const runsAs = (id) => (id === null ? 'default' : bucketOf(id) === 'aliased' ? aliases.ids[id] : bucketOf(id) === 'defined' ? id : null);
const buckets = { none: 0, defined: 0, aliased: 0, orphan: 0 };
const byAlias = {};
const byRunsAs = {};
const legacyVisible = {};
for (const row of rows) {
  const bucket = bucketOf(row.effective);
  buckets[bucket]++;
  const target = runsAs(row.effective);
  byRunsAs[target === null ? '(不可解析)' : target] = (byRunsAs[target === null ? '(不可解析)' : target] ?? 0) + 1;
  if (bucket !== 'aliased') continue;
  const entry = byAlias[row.effective] ?? { total: 0, visible: 0, hidden: 0, runsAs: target };
  entry.total++;
  if (workspace.listed.has(row.sid)) { entry.visible++; legacyVisible[row.project] = (legacyVisible[row.project] ?? 0) + 1; }
  else entry.hidden++;
  byAlias[row.effective] = entry;
}
const visible = rows.filter((row) => workspace.listed.has(row.sid));
const noTitle = rows.filter((row) => row.title === null && row.events > 0);
const report = {
  generatedAt: new Date().toISOString(),
  home: HOME,
  profile: PROFILE,
  roster: { ids: [...roster.ids].sort(), source: roster.source },
  aliases: aliases.ids,
  sessions: rows.length,
  storage,
  preset: { buckets, byAlias, byRunsAs },
  visibility: {
    workspaceFound: workspace.found,
    listed: visible.length,
    unlisted: rows.length - visible.length,
    unlistedWithContent: rows.filter((row) => !workspace.listed.has(row.sid) && row.events >= 2).length,
    archived: rows.filter((row) => workspace.archived.has(row.sid)).length
  },
  titles: { missing: noTitle.length, missingVisible: noTitle.filter((row) => workspace.listed.has(row.sid)).length },
  rows
};
const broken = storage.versionMismatch.length + storage.identityMismatch.length + storage.ghosts.length + storage.legacyFlat.length;
const failed = broken > 0 || buckets.orphan > 0;

if (AS_JSON) {
  process.stdout.write(JSON.stringify(report, null, 2) + NL);
  process.exit(failed ? 1 : 0);
}

const pct = (n) => (rows.length === 0 ? '0%' : ((n / rows.length) * 100).toFixed(1) + '%');
console.log('DSH home：' + HOME + '（profile：' + PROFILE + '）');
console.log('会话数：' + rows.length + '（每个会话只取世代号最大的日志；历史世代文件另计）');
console.log('');
console.log('① 存储层（能不能打开）');
console.log('   目录 ' + storage.dirs + '，通过 ' + storage.ok + '｜reject 共 ' + broken);
if (broken > 0) {
  for (const item of [...storage.versionMismatch, ...storage.identityMismatch, ...storage.ghosts].slice(0, LIMIT)) console.log('   ✗ ' + JSON.stringify(item));
  for (const file of storage.legacyFlat.slice(0, LIMIT)) console.log('   ✗ 旧扁平布局：' + file);
} else {
  console.log('   ✓ 世代文件名与 header.version 一致、header 的 id/cwd 与目录路径一致、无幽灵目录');
}
if (storage.staleGenerations > 0) {
  console.log('   · 同一目录下另有 ' + storage.staleGenerations + ' 份历史世代日志（' + (storage.staleBytes / 1048576).toFixed(1) + ' MB），按选取规则被忽略');
}
console.log('');
console.log('② 解析层（preset id 能不能解析）');
console.log('   roster（' + roster.source + '）：' + [...roster.ids].sort().join(', '));
console.log('   alias 表：' + Object.keys(aliases.ids).length + ' 个历史 id → ' + aliases.canonical);
console.log('   分布：defined ' + buckets.defined + '｜aliased ' + buckets.aliased + '｜none ' + buckets.none + '｜orphan ' + buckets.orphan);
if (buckets.orphan > 0) {
  for (const row of rows.filter((r) => bucketOf(r.effective) === 'orphan').slice(0, LIMIT)) console.log('   ✗ ' + row.sid + ' → ' + row.effective);
}
console.log('');
console.log('③ 记录层（打开后头部标签写什么）');
if (buckets.aliased === 0) console.log('   ✓ 没有会话记录历史 id');
else {
  console.log('   ! ' + buckets.aliased + ' 个会话记录的是历史 id（' + pct(buckets.aliased) + '），解析靠 alias 兜底，');
  console.log('     但头部标签是按 roster 查名字的，查不到就直接显示原始 id → 视觉上“没对齐”。');
  for (const [id, entry] of Object.entries(byAlias).sort((a, b) => b[1].total - a[1].total)) {
    console.log('     ' + String(entry.total).padStart(4) + '  ' + id.padEnd(24) + ' 侧栏可见 ' + String(entry.visible).padStart(3) + '  不可见 ' + String(entry.hidden).padStart(3) + '  → 实际跑 ' + entry.runsAs);
  }
  console.log('   一次性改写：node scripts/retarget-session-presets.mjs --apply --yes --force（需先停 dsh）');
}
console.log('');
console.log('④ 组合层（打开后实际跑哪个预设）');
for (const [id, count] of Object.entries(byRunsAs).sort((a, b) => b[1] - a[1])) console.log('   ' + String(count).padStart(5) + '  ' + id);
const noneRows = rows.filter((row) => row.effective === null);
if (noneRows.length > 0) {
  console.log('   其中 ' + noneRows.length + ' 个会话没有记录 preset（多为自动化/实验会话）→ 解析时走 registry 的 selectedDefault');
}
console.log('');
console.log('⑤ 可见性与标题');
console.log('   侧栏可见 ' + visible.length + '｜不在任何工作区 ' + (rows.length - visible.length) + '（其中 ≥2 事件 ' + report.visibility.unlistedWithContent + '）｜已归档 ' + report.visibility.archived);
console.log('   有内容但没有 session/title 事件：' + noTitle.length + '（可见 ' + report.titles.missingVisible + '）→ 首次打开时由 DSH 用首句回填');
console.log('');
console.log(failed ? '结论：存在需要处理的问题（见 ①② 的 ✗）' : '结论：四层不变量全部成立；③ 是唯一的“观感差异”，可用上面的 retarget 一次性消除');
process.exit(failed ? 1 : 0);
