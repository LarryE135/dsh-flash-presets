#!/usr/bin/env node
/**
 * 一次性把会话日志里记录的历史 preset id 迁移到当前 id。**默认 dry-run**。
 *
 * 为什么需要它：alias 层（lib/preset-alias.js）能让旧会话正常打开，但会话里写的仍是旧 id。
 * 想彻底清掉兼容负担时，用本脚本把 header.agentPreset 与 agent-preset/selected 事件里的
 * 历史 id 就地改写成当前 id —— 之后 alias 表可以删，picker 也不会再多出东西。
 *
 * 安全约束（每条都对应一次真实事故，改动前请读完）
 *  1. 帧级改写：只重编码“确实含目标行”的帧，其余帧按字节原样拼接；
 *     0.2.6 的截断事故就是“整文件解码-重编码”把事件帧丢了。
 *  2. 首帧只允许是 header 一行（上游 materialize 的约定）；不符就跳过该会话并报告。
 *  3. 写前整份备份到 <DSH_HOME>/backups/preset-retarget-<ts>/<相对路径>，并写 manifest.json。
 *  4. 原子写：临时文件 → fsync → rename；写完立即做两遍独立校验：
 *       a) 逐行语义比对：除被改写的 agentPreset 字段外，其余行必须与原日志完全一致，行数一致；
 *       b) 从磁盘重读：header / 最后一条 selection 都不再残留旧 id。
 *     校验不过 → 立刻回滚该文件并记为失败。
 *  5. 同步清掉该会话的投影缓存（storages/session_projcache/…）。缓存是“按 seq 续算”的，
 *     改写了更早的事件而留着缓存，会让旧值一直被延续——这是 0.2.8 自愈没生效的原因。
 *  6. 幂等：已是目标 id 的会话不改写；重复跑不会产生第二次改动。
 *
 * 用法：
 *   node scripts/retarget-session-presets.mjs                        # dry-run，列出将改动什么
 *   node scripts/retarget-session-presets.mjs --dsh-home /mnt/c/Users/X/.dsh
 *   node scripts/retarget-session-presets.mjs --apply --yes           # 真写
 *   node scripts/retarget-session-presets.mjs --revert ~/.dsh/backups/preset-retarget-<ts>
 *
 * 建议：先停掉 DSH（systemctl stop dsh-web 或关掉 Windows 端），再 --apply，然后重启。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback; };
const HOME = arg('--dsh-home', process.env.DSH_HOME || path.join(os.homedir(), '.dsh'));
const APPLY = has('--apply');
const YES = has('--yes');
const FORCE = has('--force');
const REVERT = arg('--revert', null);
const LIMIT = Number(arg('--limit', '0')) || 0;
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const NL = String.fromCharCode(10);

const mapFile = path.join(repo, 'presets', 'legacy-preset-map.json');
const mapDoc = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
const CANONICAL = arg('--to', mapDoc.canonical);
const ALIASES = mapDoc.aliases || {};
const WANTED = (() => {
  const only = arg('--ids', null);
  if (only === null) return Object.keys(ALIASES);
  const set = new Set(only.split(',').map((s) => s.trim()).filter(Boolean));
  return Object.keys(ALIASES).filter((id) => set.has(id));
})();
const ALIAS_SET = new Set(WANTED);

if (REVERT !== null) {
  revert(REVERT);
  process.exit(0);
}

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
    const slice = buf.subarray(offs[k], end);
    let text = null;
    try { text = zlib.zstdDecompressSync(slice).toString('utf8'); } catch { text = null; }
    frames.push({ start: offs[k], end, slice, text });
  }
  return frames;
}

/** 只改 header 与 agent-preset/selected 两类行；优先做字节级替换，失败再回退到重新序列化。 */
function retargetLine(line, isHeaderLine) {
  let parsed;
  try { parsed = JSON.parse(line); } catch { return null; }
  const looksHeader = isHeaderLine && parsed !== null && typeof parsed === 'object' && typeof parsed.id === 'string';
  const isSelection = parsed !== null && typeof parsed === 'object' && parsed.type === 'agent-preset/selected';
  if (!looksHeader && !isSelection) return null;
  const current = isSelection ? (parsed.data && parsed.data.agentPreset) : parsed.agentPreset;
  if (typeof current !== 'string' || !ALIAS_SET.has(current)) return null;
  for (const oldId of [current]) {
    const surgical = line.split('"agentPreset":"' + oldId + '"').join('"agentPreset":"' + CANONICAL + '"');
    if (surgical !== line) {
      try { if (JSON.parse(surgical).agentPreset === undefined) { /* header 情况下面处理 */ } } catch { /* fallthrough */ }
      const ok = (() => { try { const p2 = JSON.parse(surgical); return isSelection ? (p2.data && p2.data.agentPreset) === CANONICAL : p2.agentPreset === CANONICAL; } catch { return false; } })();
      if (ok) return surgical;
    }
  }
  const clone = JSON.parse(line);
  if (isSelection) clone.data = { ...clone.data, agentPreset: CANONICAL };
  else clone.agentPreset = CANONICAL;
  return JSON.stringify(clone);
}

function analyze(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0xfd2fb528) return { ok: false, reason: 'not-zstd' };
  const frames = decodeFrames(buf);
  if (frames.length === 0) return { ok: false, reason: 'no-frame' };
  if (frames.some((f) => f.text === null)) return { ok: false, reason: 'undecodable-frame' };
  const firstLines = frames[0].text.split(NL).filter(Boolean);
  if (firstLines.length !== 1) return { ok: false, reason: 'first-frame-has-' + firstLines.length + '-lines' };
  let header;
  try { header = JSON.parse(firstLines[0]); } catch { return { ok: false, reason: 'bad-header' }; }
  // 收集所有 selection 行及其值；有效 preset = 最后一条 selection，没有则是 header。
  let lastSelection = null;
  const selectionLines = [];
  frames.forEach((frame, fi) => {
    const lines = frame.text.split(NL);
    lines.forEach((line, li) => {
      if (line === '' || (fi === 0 && li === 0)) return;
      let ev; try { ev = JSON.parse(line); } catch { return; }
      if (ev.type !== 'agent-preset/selected') return;
      const value = ev.data && ev.data.agentPreset;
      selectionLines.push({ frame: fi, line: li, value });
      lastSelection = value;
    });
  });
  const headerPreset = typeof header.agentPreset === 'string' ? header.agentPreset : null;
  const effective = lastSelection !== null ? lastSelection : headerPreset;
  // 只改写“决定解析结果”的那一处：有 selection 就改最后一条，否则改 header。
  // 中间过程出现过的旧 id 不影响解析（投影按顺序覆盖），不做无谓改写。
  let spot = null;
  if (lastSelection !== null) {
    const last = selectionLines[selectionLines.length - 1];
    if (ALIAS_SET.has(last.value)) spot = { frame: last.frame, line: last.line };
  } else if (headerPreset !== null && ALIAS_SET.has(headerPreset)) {
    spot = { frame: 0, line: 0 };
  }
  const edits = [];
  if (spot !== null) {
    const line = frames[spot.frame].text.split(NL)[spot.line];
    const replaced = retargetLine(line, spot.frame === 0 && spot.line === 0);
    if (replaced === null) return { ok: false, reason: 'retarget-unparsed' };
    edits.push({ frame: spot.frame, line: spot.line, before: line, after: replaced });
  }
  return { ok: true, buf, frames, header, edits, effective, headerPreset };
}
function rebuild(buf, frames, edits) {
  const byFrame = new Map();
  for (const e of edits) {
    if (!byFrame.has(e.frame)) byFrame.set(e.frame, []);
    byFrame.get(e.frame).push(e);
  }
  const pieces = [];
  frames.forEach((frame, fi) => {
    if (!byFrame.has(fi)) { pieces.push(frame.slice); return; }
    const lines = frame.text.split(NL);
    for (const e of byFrame.get(fi)) lines[e.line] = e.after;
    pieces.push(zlib.zstdCompressSync(Buffer.from(lines.join(NL), 'utf8')));
  });
  return Buffer.concat(pieces);
}

/** 第一遍校验：逐行语义比对，只允许 agentPreset 字段变化。 */
function verifySemantics(oldBuf, newBuf, edits) {
  const oldFrames = decodeFrames(oldBuf);
  const newFrames = decodeFrames(newBuf);
  if (oldFrames.length !== newFrames.length) return 'frame-count ' + oldFrames.length + '->' + newFrames.length;
  const keyOf = (e) => e.frame + ':' + e.line;
  const expect = new Map(edits.map((e) => [keyOf(e), e.after]));
  for (let fi = 0; fi < oldFrames.length; fi++) {
    if (newFrames[fi].text === null) return 'undecodable-new-frame@' + fi;
    const a = oldFrames[fi].text.split(NL);
    const b = newFrames[fi].text.split(NL);
    if (a.length !== b.length) return 'line-count-frame' + fi + ' ' + a.length + '->' + b.length;
    for (let li = 0; li < a.length; li++) {
      const want = expect.get(fi + ':' + li);
      if (want === undefined) { if (a[li] !== b[li]) return 'unexpected-diff@' + fi + ':' + li; continue; }
      if (b[li] !== want) return 'edit-mismatch@' + fi + ':' + li;
      const before = JSON.parse(a[li]); const after = JSON.parse(b[li]);
      const strip = (o) => { const c = JSON.parse(JSON.stringify(o)); if (c.type === 'agent-preset/selected' && c.data) delete c.data.agentPreset; else delete c.agentPreset; return JSON.stringify(c); };
      if (strip(before) !== strip(after)) return 'non-preset-field-changed@' + fi + ':' + li;
    }
  }
  return null;
}

/** 第二遍校验：从磁盘重读，确认没有残留旧 id。 */
function verifyFromDisk(file) {
  const info = analyze(file);
  if (!info.ok) return 're-analyze: ' + info.reason;
  for (const e of info.edits) return 'still-retargetable@' + e.frame + ':' + e.line;
  if (typeof info.effective === 'string' && ALIAS_SET.has(info.effective)) return 'effective-still-alias:' + info.effective;
  return null;
}

function purgeProjectionCache(sessionId) {
  const dir = path.join(HOME, 'storages', 'session_projcache', 'sessions');
  const removed = [];
  for (const name of ['session-' + sessionId + '.json', sessionId + '.json']) {
    const p = path.join(dir, name);
    try { if (fs.existsSync(p)) { fs.unlinkSync(p); removed.push(p); } } catch { /* 缓存删不掉不影响正确性，只是更慢 */ }
  }
  return removed;
}

function revert(dir) {
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let restored = 0;
  for (const row of manifest.files) {
    const backup = path.join(dir, row.rel);
    if (!fs.existsSync(backup)) { console.log('缺少备份：' + backup); continue; }
    fs.copyFileSync(backup, row.file);
    restored++;
  }
  console.log('已回滚 ' + restored + ' / ' + manifest.files.length + ' 个文件（投影缓存会在下次启动自动重建）');
}

const sessionsRoot = path.join(HOME, 'sessions');
if (!fs.existsSync(sessionsRoot)) { console.log('没有 sessions 目录：' + sessionsRoot); process.exit(0); }

const targets = [];
const skipped = [];
let staleSkipped = 0;
// 与 DSH 的选取规则一致：同一个会话目录里只认世代号最大的那份日志（audit-align 用同一口径）。
// 历史世代的文件永远读不到，改写它们只会放大备份体积、并在报告里制造重复行。
const walk = (dir) => {
  const generations = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    const m = /^session(?:\.v([1-9][0-9]*))?\.jsonl(\.zstd)?$/.exec(e.name);
    if (m === null) continue;
    if (m[2] !== '.zstd') continue; // 未压缩日志（编码不匹配）不是本脚本的事
    generations.push({ file: p, version: m[1] === undefined ? 0 : Number(m[1]) });
  }
  if (generations.length === 0) return;
  generations.sort((a, b) => b.version - a.version);
  staleSkipped += generations.length - 1;
  const selected = generations[0];
  const info = analyze(selected.file);
  if (!info.ok) { skipped.push({ file: selected.file, reason: info.reason }); return; }
  if (info.edits.length === 0) return;
  targets.push({ file: selected.file, info });
};
walk(sessionsRoot);

console.log('DSH home：' + HOME);
console.log('目标 id：' + CANONICAL + '（参与迁移的历史 id：' + WANTED.length + ' 个）');
console.log('待改写会话：' + targets.length + '   跳过（结构异常）：' + skipped.length + (staleSkipped > 0 ? '   历史世代文件（不动）：' + staleSkipped : ''));
const shown = LIMIT > 0 ? targets.slice(0, LIMIT) : targets;
for (const t of shown) {
  const id = path.basename(path.dirname(t.file));
  console.log('  ' + id + '  ' + t.info.edits.length + ' 处  ' + t.info.effective + ' → ' + CANONICAL);
}
if (LIMIT > 0 && targets.length > LIMIT) console.log('  …（--limit 只列出前 ' + LIMIT + ' 条，实际 ' + targets.length + ' 条）');
for (const s of skipped.slice(0, 5)) console.log('  [跳过] ' + s.reason + '  ' + s.file.replace(HOME, '~/.dsh'));

if (!APPLY) {
  console.log('');
  console.log('（dry-run：未写任何文件。确认无误后加 --apply --yes；建议先停掉 DSH。）');
  process.exit(0);
}
if (!YES) { console.log(''); console.log('拒绝写入：需要同时给 --apply 与 --yes。'); process.exit(2); }
if (!FORCE) {
  console.log('');
  console.log('拒绝写入：DSH 正在运行时改写会话日志不安全（内存里的投影会覆盖你的改动）。');
  console.log('先停 DSH，或确认完全停掉后加 --force。');
  process.exit(3);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(HOME, 'backups', 'preset-retarget-' + stamp);
fs.mkdirSync(backupDir, { recursive: true });
const manifest = { stamp, home: HOME, canonical: CANONICAL, aliases: WANTED, files: [] };
let changed = 0;
let failed = 0;

for (const t of targets) {
  const rel = path.relative(sessionsRoot, t.file);
  const backup = path.join(backupDir, rel);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.copyFileSync(t.file, backup);
  const sessionId = path.basename(path.dirname(t.file));
  const newBuf = rebuild(t.info.buf, t.info.frames, t.info.edits);
  const semantic = verifySemantics(t.info.buf, newBuf, t.info.edits);
  if (semantic !== null) {
    failed++;
    console.log('  ✖ 预校验失败，未写入：' + sessionId + '（' + semantic + '）');
    continue;
  }
  const before = fs.statSync(t.file);
  const mtime = before.mtime;
  const tmp = t.file + '.retarget-tmp';
  // 保留原文件权限位：会话文件是 600，rename 出来的新文件若按默认 umask 会变 644
  const fd = fs.openSync(tmp, 'w', before.mode & 0o777);
  fs.writeSync(fd, newBuf);
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(tmp, t.file);
  try { fs.chmodSync(t.file, before.mode & 0o777); } catch {}
  try { fs.utimesSync(t.file, mtime, mtime); } catch {}
  const disk = verifyFromDisk(t.file);
  if (disk !== null) {
    failed++;
    fs.copyFileSync(backup, t.file);
    console.log('  ✖ 写后校验失败，已回滚：' + sessionId + '（' + disk + '）');
    continue;
  }
  const purged = purgeProjectionCache(sessionId);
  manifest.files.push({ file: t.file, rel, sessionId, edits: t.info.edits.length, purgedCache: purged.length });
  changed++;
}

fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('');
console.log('完成：改写 ' + changed + ' 个会话，失败 ' + failed + ' 个。');
console.log('备份 + manifest：' + backupDir);
console.log('回滚：node scripts/retarget-session-presets.mjs --revert ' + backupDir);
process.exit(failed ? 1 : 0);