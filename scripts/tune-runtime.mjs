#!/usr/bin/env node
/**
 * 运行时调优开关：把两项 run_code 开销优化落到 profile 里（幂等、带备份）。
 *
 *   B  PTC 常驻运行时：cordis.patch.yml 里 ptc-runtime.executionMode = persistent-in-memory
 *   A  fs-search 只读并发：给 glob / grep 工具补 isConcurrencySafe（原生多调用可并行）
 *
 *   node scripts/tune-runtime.mjs                 # = --check，只报告，不改文件
 *   node scripts/tune-runtime.mjs --apply         # 缺什么补什么（先备份）
 *   node scripts/tune-runtime.mjs --apply --profile web
 *
 * 退出码：0 全部就位；1 有缺失（--check 时）；2 环境问题（找不到 profiles）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const A = process.argv.slice(2);
const APPLY = A.includes('--apply');
// 只有显式 --profile 才收窄；环境里的 DSH_PROFILE 不参与，否则默认只查一个 profile 很坑。
const only = (() => {
  const i = A.indexOf('--profile');
  return i >= 0 ? A[i + 1] : null;
})();

const ROOT = path.join(os.homedir(), '.dsh', 'profiles');
const FS_PKG = path.join('node_modules', '@deepseek-ai', 'dsh-tool-fs-search', 'lib', 'index.js');
const MARK = '# >>> tune-runtime: PTC 常驻运行时';
const BLOCK = `
${MARK}
# 每个 run_code program 只付一次启动成本；嵌套工具调用 44ms → 15ms。
- id: ptc-runtime
  config:
    executionMode: persistent-in-memory
`;

function backup(file) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const dst = `${file}.bak-tune-${stamp}`;
  fs.copyFileSync(file, dst);
  return dst;
}

/** 权威判据：dsh --dump-config 里 ptc-runtime 的实际取值（能看见 bundle 层）。 */
function dumpSaysPersistent(profile) {
  try {
    const out = execFileSync('dsh', ['--profile', profile, '--dump-config'], {
      encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const i = out.indexOf('id: ptc-runtime');
    if (i < 0) return null;
    const block = out.slice(i, i + 400);
    return /executionMode:\s*persistent-in-memory/.test(block);
  } catch {
    return null;
  }
}

function checkB(dir, profile) {
  const via = dumpSaysPersistent(profile);
  const f = path.join(dir, 'cordis.patch.yml');
  const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  if (via === true) return { ok: true, file: f, text, source: 'dump-config' };
  const ok = /executionMode:\s*persistent-in-memory/.test(text);
  return { ok, file: f, text, source: via === null ? 'patch 文件（dump 不可用）' : 'dump-config' };
}

function applyB(dir, st, profile) {
  if (st.ok) return 'already';
  let body = (st.text || '').replace(/\s*$/, '');
  // 空补丁层常见写法是字面量 `[]`（flow 数组）：直接追加 block sequence 会变成非法 YAML，
  // 必须先把这行空数组去掉。
  if (/^\s*\[\]\s*$/.test(body.split('\n').pop() ?? '')) {
    const lines = body.split('\n');
    lines.pop();
    body = lines.join('\n').replace(/\s*$/, '');
  }
  const next = (body ? body + '\n' : '') + BLOCK + '\n';
  const bak = backup(st.file);
  fs.writeFileSync(st.file, next);
  // 写完立刻用 dump-config 验一遍；配置坏了就回滚，不留半成品。
  const okNow = dumpSaysPersistent(profile);
  if (okNow === false) {
    fs.copyFileSync(bak, st.file);
    return 'failed (dump-config 未生效，已回滚)';
  }
  return 'patched';
}

function checkA(dir) {
  const f = path.join(dir, FS_PKG);
  if (!fs.existsSync(f)) return { ok: false, reason: 'fs-search 未安装' };
  const text = fs.readFileSync(f, 'utf8');
  const n = (text.match(/isConcurrencySafe/g) || []).length;
  return { ok: n >= 2, count: n, file: f, text };
}

function applyA(dir, st) {
  if (st.ok) return 'already';
  if (!st.file || !fs.existsSync(st.file)) return 'skip（该 profile 未装 fs-search）';
  let text = fs.readFileSync(st.file, 'utf8');
  for (const name of ['glob', 'grep']) {
    const re = new RegExp('(\\n\\t\\tname: "' + name + '",\\n)');
    if (!re.test(text)) continue;
    text = text.replace(re, '$1\t\tisConcurrencySafe: () => true,   // tune-runtime：只读，原生多调用可并行\n');
  }
  const n = (text.match(/isConcurrencySafe/g) || []).length;
  if (n < 2) return 'failed (锚点未命中，未写入)';
  backup(st.file);
  fs.writeFileSync(st.file, text);
  return 'patched';
}

if (!fs.existsSync(ROOT)) {
  console.log('找不到 ' + ROOT + '，先跑一次 dsh 让它初始化 profile。');
  process.exit(2);
}

const dirs = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => path.join(ROOT, d.name))
  .filter((d) => !only || path.basename(d) === only);

if (only && !dirs.length) {
  console.log('没有匹配的 profile：' + only + '（现有：' + fs.readdirSync(ROOT).filter((n) => fs.statSync(path.join(ROOT, n)).isDirectory()).join(', ') + '）');
  process.exit(2);
}

let missing = 0;
const rows = [];
for (const dir of dirs) {
  const name = path.basename(dir);
  const b = checkB(dir, name);
  const a = checkA(dir);
  const bAction = APPLY ? applyB(dir, b, name) : (b.ok ? 'ok' : 'MISSING');
  const aAction = APPLY ? applyA(dir, a) : (a.ok ? 'ok' : (a.count === undefined ? 'n/a' : 'MISSING'));
  if (!b.ok) missing++;
  if (!a.ok && a.count !== undefined) missing++;   // 该 profile 根本没装 fs-search 时不计入缺口
  rows.push({ name, B: bAction, A: aAction, aCount: a.count ?? 0 });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('profile', 12) + pad('B 常驻运行时', 16) + pad('A 只读并发', 14) + 'isConcurrencySafe');
for (const r of rows) console.log(pad(r.name, 12) + pad(r.B, 16) + pad(r.A, 14) + r.aCount);
if (!APPLY && missing) {
  console.log('\n有 ' + missing + ' 项未就位；加 --apply 落地（会先备份）。');
  process.exit(1);
}
if (APPLY) console.log('\n完成。改过 cordis.patch.yml 的 profile 需要重启 dsh 才生效。');
