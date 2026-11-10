#!/usr/bin/env node
// 「升级之后旧会话还能不能打开」的自动化守卫（第七轮审计 A5）。
//
// 背景：0.2.6 改过 preset id，0.2.9 又退役过一批；这类回归的症状是「装上新版，旧会话直接打不开」，
// 而它是**静默**的 —— 只在打开那个会话时才炸。之前没有任何测试覆盖它，靠人肉开 GUI 碰运气。
//
// 这里用合成的会话文件（明文 jsonl，格式与 session.v4.jsonl 一致）造 10 类会话，
// 然后让真正的解析器（audit-compat）和 doctor 去判：
//   ① 5 个历史 id         → 必须靠别名层解析（aliased）
//   ② 2 个现役 id + 内建  → 直接有定义（defined）
//   ③ 没有 agentPreset 的 → none（不算问题）
//   ④ header 写旧 id、最后一条 agent-preset/selected 写新 id → 以事件为准（defined）
// 再配两个反向控制，防止断言变成空转：
//   - `--no-alias`（模拟脚本安装 / 没装插件卡）→ 那 5 类必须判「解析不到」，exit 1；
//   - 塞一个不存在的 id → 必须进 orphan，exit 1。
//
//   node scripts/verify-session-compat.mjs            # 0 = 通过
//   node scripts/verify-session-compat.mjs --keep     # 失败时保留临时 DSH_HOME 供排查
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEEP = process.argv.includes('--keep');
const problems = [];
const check = (ok, label, detail) => {
  if (ok) console.log('  ✓ ' + label);
  else problems.push(label + (detail ? '：' + detail : ''));
};

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-compat-'));
const profileDir = path.join(home, 'profiles', 'web');
fs.mkdirSync(profileDir, { recursive: true });
// 组合包形态：别名层随包发行，profile 清单里登记 bundle（audit-compat 与 doctor 都按这个判形态）。
fs.copyFileSync(path.join(repo, 'cordis.patch.yml'), path.join(profileDir, 'cordis.patch.yml'));
fs.writeFileSync(path.join(profileDir, 'package.json'),
  JSON.stringify({ name: 'web', dsh: { profile: { bundles: ['dsh-flash-presets'] } } }, null, 1));

const SESS = path.join(home, 'sessions', 'proj-a');
fs.mkdirSync(SESS, { recursive: true });
let seq = 0;
// 每个会话一个目录：DSH 的会话文件名是固定的（session.v4.jsonl / session.jsonl / …），
// audit-compat 的扫描器也只认这些名字，靠目录区分会话（project = 会话目录的父目录名）。
function session(agentPreset, { last, events = 3 } = {}) {
  const id = 'S' + String(++seq).padStart(3, '0');
  const dir = path.join(SESS, id);
  fs.mkdirSync(dir, { recursive: true });
  const lines = [JSON.stringify({ type: 'session', id, agentPreset, createdAt: new Date().toISOString() })];
  for (let i = 0; i < events; i++) lines.push(JSON.stringify({ type: 'user/message', data: { text: 'q' + i } }));
  if (last !== undefined) lines.push(JSON.stringify({ type: 'agent-preset/selected', data: { agentPreset: last } }));
  const file = path.join(dir, 'session.v4.jsonl');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

const LEGACY = ['flash-lean-ptc-v3-lite', 'flash-lean-ptc-v1', 'flash-lean-ptc-v2', 'flash-lean-ptc', 'flash-lean'];
for (const id of LEGACY) session(id);
session('flash-lean-ptc-v3');
session('flash-lean-ptc-v3-balance');
session('ptc');
session(undefined);                                   // 没有 agentPreset
session('flash-lean-ptc-v1', { last: 'flash-lean-ptc-v3' }); // 事件覆盖 header

const FIXTURES = seq;
function audit(extra = []) {
  const out = execFileSync(process.execPath,
    [path.join(repo, 'scripts/audit-compat.mjs'), '--dsh-home', home, '--json', ...extra],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out);
}
function auditExit(extra = []) {
  try {
    const out = execFileSync(process.execPath,
      [path.join(repo, 'scripts/audit-compat.mjs'), '--dsh-home', home, '--json', ...extra],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, json: JSON.parse(out) };
  } catch (error) {
    const out = String(error.stdout || '');
    let json = null; try { json = JSON.parse(out); } catch { /* 非 JSON 也给个空 */ }
    return { code: error.status, json };
  }
}

// ── 正向：装上组合包（含别名层）之后，10 类会话都能解析 ────────────────
console.log('[1] 组合包形态：' + FIXTURES + ' 类会话');
const pos = auditExit();
check(pos.code === 0, 'audit-compat exit 0（没有打不开的会话）', 'exit=' + pos.code);
const r = pos.json || {};
check(!!r.counts, 'JSON 输出可解析（counts 存在）');
const aliased = Object.keys(r.aliasedBy || {}).sort();
check(LEGACY.slice().sort().join(',') === aliased.join(','), '5 个历史 id 全部走别名层', aliased.join(','));
check(!Object.keys(r.unresolvedBy || {}).length, '没有「解析不到」的会话', JSON.stringify(r.unresolvedBy));
check(!Object.keys(r.orphanBy || {}).length, '没有孤儿 id', JSON.stringify(r.orphanBy));
check((r.counts || {}).defined === 4, '4 类按定义解析（v3 / balance / 内建 ptc / 事件覆盖那条）', JSON.stringify(r.counts));
check((r.counts || {}).none === 1, '没有 agentPreset 的那类记 none，不算问题', JSON.stringify(r.counts));
check((r.counts || {}).aliased === 5, '别名层承接 5 类', JSON.stringify(r.counts));
check(!(r.damagedCount > 0), '没有结构可疑会话');

// ── 反向 1：没有别名层（脚本安装形态）必须判「解析不到」和 exit 1 ──────
console.log('[2] 反向控制：--no-alias（脚本安装形态）');
const neg = auditExit(['--no-alias']);
check(neg.code === 1, 'exit 1（不是静默通过）', 'exit=' + neg.code);
check(Object.keys((neg.json || {}).unresolvedBy || {}).length === 5, '5 个历史 id 判为解析不到',
  JSON.stringify(Object.keys((neg.json || {}).unresolvedBy || {})));

// ── 反向 2：孤儿 id 必须被抓出来 ────────────────────────────────────────
console.log('[3] 反向控制：孤儿 id');
const ghost = path.join(SESS, 'S' + String(1).padStart(3, '0'), 'session.v4.jsonl');
const saved = fs.readFileSync(ghost, 'utf8');
fs.writeFileSync(ghost, JSON.stringify({ type: 'session', id: 'SGHOST', agentPreset: 'ghost-preset-x' }) + '\n');
const orph = auditExit();
check(orph.code === 1, '孤儿 id → exit 1', 'exit=' + orph.code);
check(Object.keys((orph.json || {}).orphanBy || {}).includes('ghost-preset-x'), '孤儿 id 出现在 orphanBy',
  JSON.stringify(Object.keys((orph.json || {}).orphanBy || {})));
fs.writeFileSync(ghost, saved);

// ── doctor 的会话检查也要放行（同一份数据，两个入口） ──────────────────
// 这里只断言 [7]「旧会话的预设 id」这一段：fixture 的补丁是**未经 install.sh 解析**的原始组合补丁，
// [4] 会因为它带着 !!js 标签而报红 —— 那与「旧会话能不能打开」无关，别把两件事混在一个断言里。
console.log('[4] doctor --sessions 的 [7] 段');
let docOut = '';
let docStatus = 0;
try {
  docOut = execFileSync(process.execPath, [path.join(repo, 'scripts/doctor.mjs'), '--profile', 'web', '--sessions'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DSH_HOME: home } });
} catch (error) {
  docStatus = error.status === undefined ? 1 : error.status;
  docOut = String(error.stdout || '') + String(error.stderr || '');
}
const sec7 = (() => {
  const i = docOut.indexOf('[7]');
  const j = docOut.indexOf('[8]');
  return i >= 0 ? docOut.slice(i, j > i ? j : undefined) : '';
})();
check(sec7.length > 0, 'doctor 输出了 [7] 段（没有提前退出）', docOut.split('\n').slice(-3).join(' / ').slice(0, 120));
check(/✓/.test(sec7), 'doctor 对这批会话给的是通过态', sec7.trim().split('\n').slice(0, 3).join(' / ').slice(0, 140));
check(!/✗/.test(sec7), '[7] 段里没有 ✗', sec7.trim().split('\n').slice(0, 3).join(' / ').slice(0, 140));

if (problems.length > 0) {
  console.error('✖ 升级后旧会话能否打开：' + problems.length + ' 处不通过');
  for (const p of problems) console.error('  - ' + p);
  console.error('  临时 DSH_HOME：' + home);
  process.exit(1);
}
if (!KEEP) fs.rmSync(home, { recursive: true, force: true });
console.log('✓ 升级后 ' + FIXTURES + ' 类会话都能打开（别名层覆盖 5 个历史 id；没有别名层时会被抓出来）');