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

// 尊重 DSH_HOME：隔离环境（DSH_HOME=/tmp/x）里跑安装器时不能去改真实的 ~/.dsh。
  const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const ROOT = path.join(DSH_HOME, 'profiles');
const FS_PKG = path.join('node_modules', '@deepseek-ai', 'dsh-tool-fs-search', 'lib', 'index.js'); // 旧落点，仅留作历史参考

function semverAtLeast(version, min) {
  const parse = (v) => String(v).split('.').map((x) => Number.parseInt(x, 10) || 0);
  const a = parse(version);
  const b = parse(min);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return true;
}
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

// A 已改由插件提供（0.2.6 起）：glob/grep 的定义对象由 plan-mode-ui 的
// lib/tool-concurrency.js 在运行期补 isConcurrencySafe。以前的实现是改 profile 里的
// node_modules/@deepseek-ai/dsh-tool-fs-search/lib/index.js，但 0.2.2-rc.1 起该包不再
// 是 profile 依赖（从全局 dsh 安装解析），那条路径不存在，补丁静默失效。
const PLUGIN_PKG = path.join('node_modules', 'dsh-flash-presets', 'package.json');
const PLUGIN_MOD = path.join('node_modules', 'dsh-flash-presets', 'lib', 'tool-concurrency.js');
const MIN_PLUGIN = '0.2.6';

function checkA(dir) {
  const pkg = path.join(dir, PLUGIN_PKG);
  if (!fs.existsSync(pkg)) return { ok: false, reason: '未安装 dsh-flash-presets', version: null };
  let version = null;
  try { version = JSON.parse(fs.readFileSync(pkg, 'utf8')).version ?? null; } catch { version = null; }
  const hasModule = fs.existsSync(path.join(dir, PLUGIN_MOD));
  const ok = hasModule && typeof version === 'string' && semverAtLeast(version, MIN_PLUGIN);
  return { ok, version, hasModule, file: pkg };
}

function applyA(dir, st) {
  if (st.ok) return 'already（插件 ' + st.version + '）';
  if (st.version === null) return 'skip（未安装 dsh-flash-presets）';
  if (!st.hasModule) return 'needs-upgrade（插件 ' + st.version + ' 无 tool-concurrency.js）';
  return 'needs-upgrade（插件 ' + st.version + ' < ' + MIN_PLUGIN + '）';
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
  const aAction = APPLY ? applyA(dir, a) : (a.ok ? 'ok（插件 ' + (a.version ?? '?') + '）' : (a.version === null ? 'n/a（未装插件）' : 'MISSING'));
  if (!b.ok) missing++;
  if (!a.ok && a.version !== null) missing++;   // 该 profile 根本没装 fs-search 时不计入缺口
  rows.push({ name, B: bAction, A: aAction, aCount: a.ok ? 2 : 0 });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('profile', 12) + pad('B 常驻运行时', 16) + pad('A 只读并发', 26) + 'isConcurrencySafe');
for (const r of rows) console.log(pad(r.name, 12) + pad(r.B, 16) + pad(r.A, 14) + r.aCount);
if (!APPLY && missing) {
  console.log('\n有 ' + missing + ' 项未就位；加 --apply 落地（会先备份）。');
  process.exit(1);
}
if (APPLY) console.log('\n完成。改过 cordis.patch.yml 的 profile 需要重启 dsh 才生效。');
