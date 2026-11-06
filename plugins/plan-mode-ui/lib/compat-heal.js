// 旧 preset id 自愈（2026-11-06 事故后重写）。
//
// 目的：用户升级到只定义 v3 的版本后，header 里仍写 flash-lean / flash-lean-ptc / -v1 / -v2
// 的旧会话会以 agent-preset/not-found 打不开。这里把它们静默改写成当前 id，用户无感。
//
// 安全约束（每一条都对应一次真实事故）：
//  0. 帧边界按 zstd 帧头逐块走（同上游 scanZstdFrames），不扫 magic 字节；末尾帧不完整就整份不动
//  1. 只重编码首帧 header，其余帧按字节原样拼接；绝不解码-重编码事件（0.2.6 截断事故的成因），
//     写完再逐帧解压比文本（而不是比切片字节，那是自证）
//  2. 写临时文件 → 校验 → rename；校验失败就放弃，原文件不动
//  3. 每个文件先整份备份到 $DSH_HOME/backups/preset-heal-<ts>/<相对路径>
//  4. 只处理白名单里的历史 id；未知 id 一律跳过，不做猜测
//  5. 每个 DSH_HOME 用锁文件互斥；日志写 $DSH_HOME/logs/preset-heal.log
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, renameSync, copyFileSync, unlinkSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { homedir } from 'node:os';
import { zstdCompressSync, zstdDecompressSync, constants as zc } from 'node:zlib';

export const LEGACY_PRESET_IDS = ['flash-lean', 'flash-lean-ptc', 'flash-lean-ptc-v1', 'flash-lean-ptc-v2', 'flash-lean-ptc-v3'];
export const CURRENT_PRESET_ID = 'flash-lean-ptc-v3-lite';
// 帧切分照抄 DSH 自己的 scanZstdFrames（dsh-session-persistence-jsonl）：按帧头逐块走，
// 绝不能靠扫描 magic 字节 —— 压缩数据里出现同样的 4 个字节就会切错，DSH 读会话时会报
// corrupt Zstandard session log: invalid frame magic，会话直接打不开（第四轮审计 P1-1）。
const MAGIC_U32 = 4247762216;
const CHECKSUM_OPTS = { params: { [zc.ZSTD_c_checksumFlag]: 1 } };
const NL = String.fromCharCode(10);
const HEAD_CHUNK = 65536;
const LOCK_STALE_MS = 10 * 60 * 1000;

function dshHome() {
  const env = process.env.DSH_HOME;
  return env !== undefined && env !== '' ? env : join(homedir(), '.dsh');
}

function msgOf(error) {
  return String((error && error.message) || error);
}

/**
 * 逐帧切分（上游 scanZstdFrames 的等价实现）。结构损坏直接抛错，末尾帧不完整返回 tornStart。
 * @returns {{frames: {start: number, end: number}[], tornStart?: number}}
 */
function scanFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== MAGIC_U32) throw new Error('invalid frame magic at byte ' + offset);
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error('reserved frame-header bit at byte ' + (offset - 1));
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error('reserved block type at byte ' + (offset - 3));
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames };
}

function frameBytes(buf, frames, k) {
  return buf.subarray(frames[k].start, frames[k].end);
}

function firstLineOf(buf, frames) {
  const text = zstdDecompressSync(frameBytes(buf, frames, 0)).toString('utf8');
  return JSON.parse(text.split(NL)[0]);
}

function readHeader(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const chunk = Buffer.alloc(HEAD_CHUNK);
    const n = readSync(fd, chunk, 0, chunk.length, 0);
    const head = chunk.subarray(0, n);
    const scanned = scanFrames(head);
    if (scanned.frames.length > 0) return firstLineOf(head, scanned.frames);
  } catch { /* 头块里没有完整首帧：走整份读 */ } finally {
    try { if (fd !== undefined) closeSync(fd); } catch { /* ignore */ }
  }
  // 首帧超过头块（极端情况）：整份读再切第一帧
  try {
    const buf = readFileSync(file);
    const scanned = scanFrames(buf);
    if (scanned.frames.length === 0) return undefined;
    return firstLineOf(buf, scanned.frames);
  } catch { return undefined; }
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
    let scanned;
    try { scanned = scanFrames(buf); } catch (error) {
      report.failed += 1; report.details.push(file + ' 帧结构损坏（' + msgOf(error) + '），不动'); continue;
    }
    if (scanned.tornStart !== undefined) {
      report.failed += 1; report.details.push(file + ' 末尾帧不完整，不动'); continue;
    }
    const frames = scanned.frames;
    if (frames.length === 0) { report.failed += 1; continue; }
    report.matched += 1;
    const patched = Object.assign({}, header, { agentPreset: target });
    // 首帧和上游一样带校验位（CHECKSUM_OPTS），其余帧原样保留字节
    const firstFrame = zstdCompressSync(Buffer.from(JSON.stringify(patched) + NL, 'utf8'), CHECKSUM_OPTS);
    const rest = frames.length > 1 ? buf.subarray(frames[1].start) : Buffer.alloc(0);
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
    // 写后校验：重新按帧头切分 + 逐帧解压比**文本**（不是比字节切片 —— 切片用的是同一套偏移，
    // 切错时自己也会错，等于自证），并确认首帧真的是改写后的 header。
    let ok = true;
    let why = '';
    try {
      const back = readFileSync(tmp);
      const backScanned = scanFrames(back);
      ok = backScanned.tornStart === undefined && backScanned.frames.length === frames.length;
      if (!ok) why = '帧数不一致';
      for (let k = 1; ok && k < frames.length; k += 1) {
        const before = zstdDecompressSync(frameBytes(buf, frames, k));
        const after = zstdDecompressSync(frameBytes(back, backScanned.frames, k));
        if (Buffer.compare(before, after) !== 0) { ok = false; why = '第 ' + (k + 1) + ' 帧内容不一致'; }
      }
      if (ok) {
        const head = JSON.parse(zstdDecompressSync(frameBytes(back, backScanned.frames, 0)).toString('utf8').split(NL)[0]);
        if (head === null || head.agentPreset !== target) { ok = false; why = '首帧未被改写'; }
      }
    } catch (error) { ok = false; why = msgOf(error); }
    if (!ok) {
      try { unlinkSync(tmp); } catch { /* ignore */ }
      report.failed += 1; report.details.push(file + ' 校验失败（' + why + '），已放弃'); continue;
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
  // 和 index.js 的调用点保持同一判据：默认关，只有显式 DSH_FLASH_PRESETS_HEAL=1 才动用户会话。
  // （原来是 === '0' 就返回，直接调这个函数时会绕过默认关闭，属于反向守卫。）
  if (process.env.DSH_FLASH_PRESETS_HEAL !== '1') return;
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