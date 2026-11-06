#!/usr/bin/env node
/**
 * 兼容性闸门：历史上发布过的每一个 preset id 必须仍然可解析，
 * 否则用过那个版本的用户的旧会话一打开就是 agent-preset/not-found（等于"会话丢了"）。
 *
 * 历史 id 不靠手写清单，而是从 git tag 里逐版本抓（v0.1.0 … 当前），
 * 再和「当前仓库里定义了的 id」比对。缺一个就 exit 1。
 *
 * 例外必须显式登记在 presets/compat-exceptions.json（id → reason + fallback），
 * 否则不许放过——防止有人随手删预设又悄悄弄丢旧会话。
 *
 *   node scripts/check-preset-compat.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
const ID_RE = /^\s*(?:- )?id: (flash-lean-ptc[\w-]*|flash-lean|codex-contract-v[0-9]+|light-ptc[\w-]*)\s*$/gm;

function idsInText(text) {
  const out = [];
  for (const m of text.matchAll(ID_RE)) out.push(m[1]);
  return out;
}

const tags = git('tag', '-l', '--sort=v:refname').split('\n').filter(Boolean);
const history = new Map();
for (const t of tags) {
  let files = [];
  try {
    files = git('ls-tree', '-r', '--name-only', t).split('\n').filter((f) => /^presets\/.*\.ya?ml$/.test(f));
  } catch { continue; }
  for (const f of files) {
    let text = '';
    try { text = git('show', t + ':' + f); } catch { continue; }
    for (const id of idsInText(text)) {
      if (!history.has(id)) history.set(id, []);
      history.get(id).push(t);
    }
  }
}

const current = new Set();
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.ya?ml$/.test(e.name)) continue;
    if (/\.bak|disabled\.|\.removed|archive/.test(e.name)) continue;
    for (const id of idsInText(fs.readFileSync(p, 'utf8'))) current.add(id);
  }
};
walk(path.join(repo, 'presets'));
const bundle = path.join(repo, 'cordis.patch.yml');
if (fs.existsSync(bundle)) for (const id of idsInText(fs.readFileSync(bundle, 'utf8'))) current.add(id);

const excPath = path.join(repo, 'presets', 'compat-exceptions.json');
const exceptions = fs.existsSync(excPath) ? JSON.parse(fs.readFileSync(excPath, 'utf8')) : {};

// 历史 id 的第三条豁免路径：运行时 alias 层（lib/preset-alias.js + presets/legacy-preset-map.json）。
// 它不新增 preset 定义、不进 picker、不写用户数据，把旧 id 在解析时映射到 canonical。
const mapPath = path.join(repo, 'presets', 'legacy-preset-map.json');
const aliasDoc = fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, 'utf8')) : { aliases: {} };
const aliases = aliasDoc.aliases && typeof aliasDoc.aliases === 'object' ? aliasDoc.aliases : {};

const failures = [];
if (typeof aliasDoc.canonical !== 'string' || !current.has(aliasDoc.canonical)) {
  failures.push('alias 表的 canonical 必须是当前仓库里真实定义过的 id，实际：' + String(aliasDoc.canonical));
}

const missing = [];
for (const [id, where] of [...history.entries()].sort()) {
  if (current.has(id) || exceptions[id] || Object.prototype.hasOwnProperty.call(aliases, id)) continue;
  missing.push({ id, last: where[where.length - 1], n: where.length });
}

console.log('历史 tag：' + tags.join(', '));
console.log('历史定义过的 preset id（' + history.size + '）：' + [...history.keys()].sort().join(', '));
console.log('当前仓库定义的 id：' + [...current].sort().join(', '));
console.log('alias 表（' + Object.keys(aliases).length + ' 个历史 id → ' + String(aliasDoc.canonical) + '）：' + Object.keys(aliases).sort().join(', '));
for (const f of failures) console.log('✖ ' + f);
if (failures.length > 0) process.exit(1);
if (missing.length) {
  console.log('');
  console.log('✖ 以下 id 历史上发布过、现在没有定义，也没有登记例外：');
  for (const m of missing) console.log('   ' + m.id + '   （最后出现于 ' + m.last + '，共 ' + m.n + ' 个版本）');
  console.log('');
  console.log('修法三选一：① 在 presets/ 补一个同内容的定义；② 加进 presets/legacy-preset-map.json 的 aliases（推荐：零数据风险、不进 picker）；③ 在 presets/compat-exceptions.json 登记 reason + fallback');
  process.exit(1);
}
console.log('✓ 历史上出现过的 preset id 全部仍可解析（或已登记例外）');