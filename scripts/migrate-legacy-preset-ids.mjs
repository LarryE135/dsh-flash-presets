#!/usr/bin/env node
/**
 * 旧会话的预设 id 迁移（**已停用写盘**）：本脚本曾把会话 id 原地改写，但 DSH 的会话日志是
 * **多帧 zstd**（header 一帧、之后每次追加一帧），Node 的 zstdDecompressSync/流式解码都只返回
 * 第一帧；rewriteHeader 用第一帧重写整个文件，等于把事件流全部丢掉。2026-11-06 那次运行因此
 * 截断了 273 个会话文件（其中 83 个原本有内容）。现在 --apply / --revert 一律拒绝执行，只保留
 * 只读扫描（doctor --sessions 用）。要做兼容请改预设层（别名定义），不要动会话数据。
 *
 * 为什么需要：0.2.5 之前的 lean 系列还有一批退役 id（`flash-lean-ptc-v1`、`-v2`、`-v3b`），
 * 0.2.7 起现役的 13 条预设沿用 `flash-lean-ptc-v3`（旧 lean-v3 的 id），所以这类会话本来就能开；
 * 该脚本只用于把「已退役 id」的会话并到现役预设上（可选、默认 dry-run）：
 *   - 网页端：继续对话会带上记录的 id → 解析不到就报 agent-preset/not-found；
 *   - 一次性 runner：直接拒绝 "runs under agent preset …, which the one-shot runner does not compose"。
 * 这个脚本把 header 里的退役 id 原地改写成 `flash-lean-ptc-v3`（现役 13 条预设），
 * 旧对话于是能继续跑；不跑也不影响 lean-v3 的历史会话。
 *
 *   node scripts/migrate-legacy-preset-ids.mjs                 # 只报告（默认 dry-run）
 *   node scripts/migrate-legacy-preset-ids.mjs --apply         # 真改（先写清单，可回滚）
 *   node scripts/migrate-legacy-preset-ids.mjs --revert <清单>  # 回滚
 *   node scripts/migrate-legacy-preset-ids.mjs --dsh-home /mnt/c/Users/X/.dsh --apply
 *
 * 安全约定：
 *   - 只改 header 第一行的 `agentPreset` 字段，事件流逐字节保留；
 *   - 保留原 mtime（否则历史会话会在列表里跳到最前）；
 *   - 最近 2 分钟内写过的会话视为“正在写”，一律跳过；
 *   - `--apply` 会把 (文件 → 原 id) 写进 $DSH_HOME/backups/preset-ids-<时间戳>.json。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const TARGET = 'flash-lean-ptc-v3';
// 真实预设一律不动：v1/v2 有它们自己的定义（0.2.9 起的兼容卡），v3/balance 是现役。
// 只剩「孤儿 id」需要映射，改写它们才不等于替用户改预设。
const KEEP = new Set([TARGET, 'flash-lean-ptc-v3-balance', 'flash-lean-ptc-v1', 'flash-lean-ptc-v2']);
const SKIP_MS = Number(process.env.PRESET_MIGRATE_SKIP_MS ?? 120000);
const SESSION_FILES = ['session.v4.jsonl.zstd', 'session.v4.jsonl', 'session.jsonl.zstd', 'session.jsonl'];

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const APPLY = has('--apply');
const QUIET = has('--quiet');
const REVERT = val('--revert');
const HOME = val('--dsh-home') ?? process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
const log = (...a) => { if (!QUIET) console.log(...a); };

/**
 * 历史 id → 现行 id `flash-lean-ptc-v3`（显示名「精简·PTC v3（lean-v3）」）。lean 系列全部对齐：
 * `-v3b`、`-v3-lite`（0.2.6 期间用过的 id）、`flash-lean-ptc`、`flash-lean` 都算 ——
 * 它们本质是同一个精简预设的历代命名。别的预设（standard / ptc / minimal / 用户自定义）一个不碰。
 */
function isLegacy(id) {
  return typeof id === 'string' && id.startsWith('flash-lean') && !KEEP.has(id);
}

function isZstd(file) {
  return file.endsWith('.zstd');
}

/** 流式解压只读到第一行就停：大会话（几 MB）不必整个解压。 */
async function readHeaderLine(file) {
  const raw = fs.createReadStream(file);
  const stream = isZstd(file) ? raw.pipe(zlib.createZstdDecompress()) : raw;
  let buf = '';
  try {
    for await (const chunk of stream) {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl >= 0) return buf.slice(0, nl);
      if (buf.length > 1 << 20) break;
    }
  } catch (error) {
    throw new Error('解压/读取失败：' + error.message);
  }
  return buf;
}

function parseHeader(line) {
  const header = JSON.parse(line);
  if (header?.type !== 'session' || typeof header.id !== 'string') throw new Error('首行不是 session header');
  return header;
}

/**
 * 只重写首行的 agentPreset；**首帧之后的所有 zstd 帧按字节原样保留**，并恢复 mtime。
 *
 * 关键坑（2026-11-06 事故）：会话日志是多帧 zstd —— header 一帧，之后每次追加一帧。
 * Node 的 zstdDecompressSync 只解出**第一帧**；用它读全文再压缩写回，会抹掉首帧之后的
 * 全部事件帧，文件退化成 ~170 B 的空壳，而 utimes 又把 mtime 还原，事后完全看不出来。
 * 所以这里只重新编码首帧，其余帧直接拼接原始字节。
 */
function firstFrameLength(buf) {
  let off = 0;
  for (;;) {
    if (off + 8 > buf.length) throw new Error('zstd: frame header truncated');
    const magic = buf.readUInt32LE(off);
    if ((magic & 0xfffffff0) === 0x184d2a50) { off += 8 + buf.readUInt32LE(off + 4); continue; }
    if (magic !== 0xfd2fb528) throw new Error('zstd: bad frame magic at ' + off);
    break;
  }
  const start = off;
  const fhd = buf[off + 4];
  off += 5;
  const fcsFlag = fhd >> 6;
  const singleSegment = (fhd >> 5) & 1;
  const checksum = (fhd >> 2) & 1;
  const dictFlag = fhd & 3;
  if (!singleSegment) off += 1;
  off += [0, 1, 2, 4][dictFlag];
  off += fcsFlag === 0 ? (singleSegment ? 1 : 0) : [0, 2, 4, 8][fcsFlag];
  for (;;) {
    if (off + 3 > buf.length) throw new Error('zstd: block header truncated');
    const bh = buf.readUIntLE(off, 3);
    off += 3;
    const last = bh & 1;
    const type = (bh >> 1) & 3;
    const size = bh >> 3;
    off += type === 1 ? 1 : size;
    if (last) break;
  }
  if (checksum) off += 4;
  if (off > buf.length) throw new Error('zstd: frame overruns file');
  return off;
}

function rewriteHeader(file, presetId) {
  const st = fs.statSync(file);
  const buf = fs.readFileSync(file);
  const tmp = file + '.tmp-presetid-' + process.pid;
  const magic = buf.length >= 4 ? buf.readUInt32LE(0) : 0;
  const isZstd = magic === 0xfd2fb528 || (magic & 0xfffffff0) === 0x184d2a50;
  if (!isZstd) {
    // 明文 jsonl：按行拼接，其余行原样保留
    const text = buf.toString('utf8');
    const nl = text.indexOf('\n');
    const header = parseHeader(nl >= 0 ? text.slice(0, nl) : text);
    header.agentPreset = presetId;
    const rest = nl >= 0 ? text.slice(nl) : '';
    fs.writeFileSync(tmp, JSON.stringify(header) + rest);
  } else {
    const firstLen = firstFrameLength(buf);
    const first = zlib.zstdDecompressSync(buf.subarray(0, firstLen)).toString('utf8');
    const nl = first.indexOf('\n');
    const header = parseHeader(nl >= 0 ? first.slice(0, nl) : first);
    header.agentPreset = presetId;
    const rest = nl >= 0 ? first.slice(nl) : '';
    const newFirst = zlib.zstdCompressSync(Buffer.from(JSON.stringify(header) + rest, 'utf8'));
    // ← 关键：首帧之后的所有帧原样拼接回去
    fs.writeFileSync(tmp, Buffer.concat([newFirst, buf.subarray(firstLen)]));
  }
  fs.renameSync(tmp, file);
  fs.utimesSync(file, st.atime, st.mtime);
}

export function listSessionFiles(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const slug of fs.readdirSync(root)) {
    const slugDir = path.join(root, slug);
    let st;
    try { st = fs.statSync(slugDir); } catch { continue; }
    if (!st.isDirectory()) continue;
    for (const name of fs.readdirSync(slugDir)) {
      const dir = path.join(slugDir, name);
      let dst;
      try { dst = fs.statSync(dir); } catch { continue; }
      if (!dst.isDirectory()) continue;
      for (const f of SESSION_FILES) {
        const file = path.join(dir, f);
        if (fs.existsSync(file)) out.push(file);
      }
    }
  }
  return out;
}

async function revert(manifestPath) {
  console.error('✖ --revert 已停用：本工具的重写路径会截断多帧会话日志（见文件头说明）。');
  console.error('  要恢复 2026-11-06 的损失，请用系统还原/影子副本还原 ~/.dsh/sessions。');
  return 3;
  // eslint-disable-next-line no-unreachable
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  // 清单里记着当轮写入的目标 id；用它判断"这条是否仍是本脚本写的"，而不是当前 TARGET
  // （版本迭代后 TARGET 会变，旧清单仍必须能回滚）。
  const written = manifest.target ?? TARGET;
  let done = 0;
  for (const entry of manifest.entries) {
    if (!fs.existsSync(entry.file)) continue;
    const header = parseHeader(await readHeaderLine(entry.file));
    if (header.agentPreset !== written) continue;
    rewriteHeader(entry.file, entry.from);
    done++;
  }
  log('已回滚 ' + done + '/' + manifest.entries.length + ' 个会话（清单 ' + manifestPath + '）');
}

async function main() {
  if (REVERT) return revert(REVERT);
  const sessions = path.join(HOME, 'sessions');
  const files = listSessionFiles(sessions);
  if (!files.length) {
    console.log('找不到会话：' + sessions);
    return 2;
  }
  const counts = new Map();
  const planned = [];
  const skipped = [];
  for (const file of files) {
    let header;
    try { header = parseHeader(await readHeaderLine(file)); } catch (error) {
      skipped.push([file, error.message]);
      continue;
    }
    if (!isLegacy(header.agentPreset)) continue;
    if (Date.now() - fs.statSync(file).mtimeMs < SKIP_MS) {
      skipped.push([file, '最近 2 分钟写过（可能在跑）']);
      continue;
    }
    counts.set(header.agentPreset, (counts.get(header.agentPreset) ?? 0) + 1);
    planned.push({ file, from: header.agentPreset });
  }

  log('DSH home：' + HOME);
  log('会话文件：' + files.length + ' 个，待迁移：' + planned.length + ' 个 → ' + TARGET);
  for (const [id, n] of [...counts].sort((a, b) => b[1] - a[1])) log('  ' + String(n).padStart(5) + '  ' + id);
  if (skipped.length) {
    log('跳过：' + skipped.length + ' 个（' + [...new Set(skipped.map((s) => s[1]))].slice(0, 3).join('；') + '）');
  }

  if (!planned.length) {
    log('无需迁移。');
    return 0;
  }
  if (!APPLY) {
    log('\n只读报告结束。--apply 已停用：重写会截断多帧会话日志（见文件头说明）。');
    return 0;
  }
  console.error('✖ --apply 已停用：本工具的重写路径会截断多帧会话日志（见文件头说明）。');
  console.error('  兼容旧会话请改预设层（别名定义），不要改会话数据。');
  return 3;

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const backupDir = path.join(HOME, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const manifestPath = path.join(backupDir, 'preset-ids-' + stamp + '.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ target: TARGET, createdAt: new Date().toISOString(), home: HOME, entries: planned }, null, 2));

  let ok = 0;
  const failed = [];
  for (const { file, from } of planned) {
    try { rewriteHeader(file, TARGET); ok++; } catch (error) { failed.push([file, error.message]); }
  }
  log('已迁移 ' + ok + '/' + planned.length + ' 个会话；清单：' + manifestPath);
  if (failed.length) {
    for (const [file, msg] of failed.slice(0, 5)) console.error('  ✖ ' + file + '：' + msg);
    console.error('  失败 ' + failed.length + ' 个（未改动，可重跑）');
    return 1;
  }
  return 0;
}

/** 给 doctor/其它脚本用：只扫 header，不改文件。 */
export async function scanSessions(home) {
  const files = listSessionFiles(path.join(home, 'sessions'));
  const legacy = new Map();
  const skipped = [];
  for (const file of files) {
    let header;
    try { header = parseHeader(await readHeaderLine(file)); } catch (error) {
      skipped.push([file, error.message]);
      continue;
    }
    if (!isLegacy(header.agentPreset)) continue;
    if (!legacy.has(header.agentPreset)) legacy.set(header.agentPreset, []);
    legacy.get(header.agentPreset).push(file);
  }
  return { files: files.length, legacy, skipped };
}

const invokedDirectly = process.argv[1]?.endsWith('migrate-legacy-preset-ids.mjs');
if (invokedDirectly) {
  main().then((code) => process.exit(code ?? 0), (error) => {
    console.error('✖ ' + (error?.message ?? error));
    process.exit(2);
  });
}
