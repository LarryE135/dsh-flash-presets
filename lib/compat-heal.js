// 旧 preset id 自愈（2026-11-06 事故后重写）。
//
// 目的：用户升级到只定义 v3 的版本后，header 里仍写 flash-lean / flash-lean-ptc / -v1 / -v2
// 的旧会话会以 agent-preset/not-found 打不开。这里把它们静默改写成当前 id，用户无感。
//
// 安全约束（每一条都对应一次真实事故）：
//  1. 只重编码首帧 header，其余帧按字节原样拼接；绝不解码-重编码事件（0.2.6 截断事故的成因）
//  2. 写临时文件 → 校验 → rename；校验失败就放弃，原文件不动
//  3. 每个文件先整份备份到 $DSH_HOME/backups/preset-heal-<ts>/<相对路径>
//  4. 只处理白名单里的历史 id；未知 id 一律跳过，不做猜测
//  5. 每个 DSH_HOME 用锁文件互斥；日志写 $DSH_HOME/logs/preset-heal.log
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, renameSync, copyFileSync, unlinkSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { homedir } from 'node:os';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';

export const LEGACY_PRESET_IDS = ['flash-lean', 'flash-lean-ptc', 'flash-lean-ptc-v1', 'flash-lean-ptc-v2', 'flash-lean-ptc-v3'];
export const CURRENT_PRESET_ID = 'flash-lean-ptc-v3-lite';
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const NL = String.fromCharCode(10);
const LOCK_STALE_MS = 10 * 60 * 1000;

function dshHome() {
  const env = process.env.DSH_HOME;
  return env !== undefined && env !== '' ? env : join(homedir(), '.dsh');
}

function frameOffsets(buf) {
  const out = [];
  let i = buf.indexOf(MAGIC, 0);
  while (i !== -1) { out.push(i); i = buf.indexOf(MAGIC, i + 1); }
  return out;
}

function sliceFrame(buf, offsets, k) {
  const end = k + 1 < offsets.length ? offsets[k + 1] : buf.length;
  return buf.subarray(offsets[k], end);
}

function readHeader(file) {
  const fd = openSync(file, 'r');
  try {
    const chunk = Buffer.alloc(16384);
    const n = readSync(fd, chunk, 0, chunk.length, 0);
    const head = chunk.subarray(0, n);
    const text = zstdDecompressSync(head).toString('utf8');
    const line = text.split(NL)[0];
    return JSON.parse(line);
  } catch {
    // 头块不够（极端情况）：退回整份读
    try {
      const buf = readFileSync(file);
      const offsets = frameOffsets(buf);
      if (offsets.length === 0) return undefined;
      return JSON.parse(zstdDecompressSync(sliceFrame(buf, offsets, 0)).toString('utf8').split(NL)[0]);
    } catch { return undefined; }
  } finally {
    try { closeSync(fd); } catch { /* ignore */ }
  }
}

function collectSessionFiles(root) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.indexOf('.jsonl.zstd') !== -1) files.push(p);
    }
  };
  walk(root);
  return files;
}

function logLine(home, text) {
  try {
    const dir = join(home, 'logs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'preset-heal.log'), '[' + new Date().toISOString() + '] ' + text + NL, { flag: 'a' });
  } catch { /* 日志失败不影响主流程 */ }
}

function acquireLock(home) {
  const lock = join(home, 'preset-heal.lock');
  try {
    if (existsSync(lock)) {
      const age = Date.now() - statSync(lock).mtimeMs;
      if (age < LOCK_STALE_MS) return undefined;
    }
    writeFileSync(lock, String(process.pid) + ' ' + new Date().toISOString() + NL);
    return lock;
  } catch { return undefined; }
}

export function healLegacyPresetIds(options) {
  const opts = options !== null && typeof options === 'object' ? options : {};
  const home = opts.home !== undefined ? opts.home : dshHome();
  const root = join(home, 'sessions');
  const report = { scanned: 0, matched: 0, healed: 0, skipped: 0, failed: 0, backupDir: undefined, details: [] };
  if (opts.force !== true) {
    const lock = acquireLock(home);
    if (lock === undefined) { report.skipped = -1; return report; }
  }
  if (!existsSync(root)) return report;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = join(home, 'backups', 'preset-heal-' + stamp);
  report.backupDir = backupDir;
  const legacy = new Set(opts.legacyIds !== undefined ? opts.legacyIds : LEGACY_PRESET_IDS);
  const target = opts.targetId !== undefined ? opts.targetId : CURRENT_PRESET_ID;
  for (const file of collectSessionFiles(root)) {
    report.scanned += 1;
    // 只看首帧：读头块（header 帧很小），避免每次启动读 500MB
    let header;
    try { header = readHeader(file); } catch { report.failed += 1; report.details.push(file + ' 解码失败'); continue; }
    if (header === undefined) continue;
    if (!legacy.has(header.agentPreset)) continue;   // 白名单之外：不动
    let buf;
    try { buf = readFileSync(file); } catch { report.failed += 1; continue; }
    const offsets = frameOffsets(buf);
    if (offsets.length === 0) { report.failed += 1; continue; }
    report.matched += 1;
    const patched = Object.assign({}, header, { agentPreset: target });
    const firstFrame = zstdCompressSync(Buffer.from(JSON.stringify(patched) + NL, 'utf8'));
    const rest = offsets.length > 1 ? buf.subarray(offsets[1]) : Buffer.alloc(0);
    const out = Buffer.concat([firstFrame, rest]);
    const rel = relative(root, file);
    const backupPath = join(backupDir, rel);
    try {
      mkdirSync(dirname(backupPath), { recursive: true });
      copyFileSync(file, backupPath);
    } catch (error) {
      report.failed += 1; report.details.push(file + ' 备份失败: ' + String(error && error.message)); continue;
    }
    const tmp = file + '.heal-tmp';
    try { writeFileSync(tmp, out); } catch (error) { report.failed += 1; report.details.push(file + ' 写入失败: ' + String(error && error.message)); continue; }
    // 写后校验：帧数一致 + 第 2..N 帧逐字节一致
    let ok = true;
    try {
      const back = readFileSync(tmp);
      const backOffsets = frameOffsets(back);
      ok = backOffsets.length === offsets.length;
      for (let k = 1; ok && k < offsets.length; k += 1) {
        if (Buffer.compare(sliceFrame(back, backOffsets, k), sliceFrame(buf, offsets, k)) !== 0) ok = false;
      }
    } catch { ok = false; }
    if (!ok) {
      try { unlinkSync(tmp); } catch { /* ignore */ }
      report.failed += 1; report.details.push(file + ' 校验失败，已放弃'); continue;
    }
    try { renameSync(tmp, file); } catch (error) {
      report.failed += 1; report.details.push(file + ' rename 失败: ' + String(error && error.message)); continue;
    }
    report.healed += 1;
  }
  if (report.healed > 0 || report.failed > 0) {
    logLine(home, JSON.stringify({ scanned: report.scanned, matched: report.matched, healed: report.healed, failed: report.failed, backupDir: report.backupDir }));
  }
  return report;
}

export function scheduleCompatHeal() {
  if (process.env.DSH_FLASH_PRESETS_HEAL === '0') return;
  const timer = setTimeout(() => {
    try {
      const report = healLegacyPresetIds();
      if (report.healed > 0) console.info('[compat-heal] 旧 preset id 会话已自愈:', report.healed, '备份:', report.backupDir);
    } catch (error) {
      console.error('[compat-heal] 自愈失败（已忽略）:', error);
    }
  }, 4000);
  if (typeof timer.unref === 'function') timer.unref();
}