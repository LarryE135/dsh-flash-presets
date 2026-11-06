#!/usr/bin/env node
/**
 * 旧会话的预设 id 迁移：把 lean 系列的历史 id 统一替换成现在的 lite 预设。
 *
 * 为什么需要：0.2.6 把 `flash-lean-ptc-v3`（13 条）改名成 `flash-lean-ptc-v3-lite`，并把
 * 旧的 `-lite`（3 条）改名成 `-balance`。会话把预设 id 写进自己的 header
 * （`session.v4.jsonl.zstd` 第一行的 `agentPreset`），恢复时按这个 id 解析：
 *   - 网页端：继续对话会带上记录的 id → 解析不到就报 agent-preset/not-found；
 *   - 一次性 runner：直接拒绝 "runs under agent preset …, which the one-shot runner does not compose"。
 * 结果就是升级后旧对话打不开。这个脚本把 header 里的旧 id 原地改成 `flash-lean-ptc-v3-lite`，
 * 旧对话于是真正跑在新 lite 上，界面里显示的也是 lite。
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

const TARGET = 'flash-lean-ptc-v3-lite';
const KEEP = new Set([TARGET, 'flash-lean-ptc-v3-balance']);
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

/** 历史 id → 现在的 lite。只认同一个包的 lean 系列，别的预设（standard/ptc/自定义）不碰。 */
function isLegacy(id) {
  return typeof id === 'string' && id.startsWith('flash-lean-ptc-') && !KEEP.has(id);
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

/** 只重写首行的 agentPreset，其余字节原样保留，并恢复 mtime。 */
function rewriteHeader(file, presetId) {
  const st = fs.statSync(file);
  const text = zlib.zstdDecompressSync(fs.readFileSync(file)).toString('utf8');
  const nl = text.indexOf('\n');
  const header = parseHeader(nl >= 0 ? text.slice(0, nl) : text);
  header.agentPreset = presetId;
  const body = nl >= 0 ? text.slice(nl) : '';
  const tmp = file + '.tmp-presetid-' + process.pid;
  fs.writeFileSync(tmp, zlib.zstdCompressSync(Buffer.from(JSON.stringify(header) + body, 'utf8')));
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
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let done = 0;
  for (const entry of manifest.entries) {
    if (!fs.existsSync(entry.file)) continue;
    const header = parseHeader(await readHeaderLine(entry.file));
    if (header.agentPreset !== TARGET) continue;
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
    log('\n这是 dry-run；加 --apply 真改（会先写可回滚清单）。');
    return 0;
  }

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
