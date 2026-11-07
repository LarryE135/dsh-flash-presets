#!/usr/bin/env node
/**
 * 兼容性闸门：历史上发布过的每一个 preset id 必须仍然可解析，
 * 否则用过那个版本的用户的旧会话一打开就是 agent-preset/not-found（等于「会话丢了」）。
 *
 * 历史 id 不靠手写清单，而是从 git tag 里逐版本抓（v0.1.0 … 当前），再和「当前仓库里
 * 定义了的 id」比对。缺一个就 exit 1。
 *
 * 三条豁免/归宿路径（按优先级）：
 *   ① 当前仓库仍然定义（presets/*.patch.yml 或 cordis.patch.yml）；
 *   ② 进 presets/legacy-preset-map.json 的 aliases（运行时解析兜底，推荐：零数据风险、不进 picker）；
 *   ③ 在 presets/compat-exceptions.json 登记 { reason, fallback, since }（最后手段，必须写清回退办法）。
 *
 * 第五轮审计 T1-3 修的就是这个脚本「形同虚设」：
 *   - 没有 tag（浅克隆 / 干净 tarball）时以前静默通过 → 现在 exit 2，明确说「无法判定」；
 *   - 冻结 id（canonical 与 -balance）以前可以被随便塞进 exceptions → 现在直接判失败；
 *   - exceptions 以前只判「键存在」→ 现在必须对象 + 非空 reason/fallback/since，且键必须真的在历史里
 *     （防「登记了一堆早已没有的 id」这种假账）；
 *   - 别名表以前没人校验 → 现在校验格式：canonical 必须存在、条目必须是 { rulesDiffer: boolean }。
 *
 *   node scripts/check-preset-compat.mjs           # 0 = 通过，1 = 失败，2 = 无法判定（缺 tag / 缺 git）
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ID_RE = /^\s*(?:- )?id: (flash-lean-ptc[\w-]*|flash-lean|codex-contract-v[0-9]+|light-ptc[\w-]*)\s*$/gm;
/** 冻结 id：这两个是发行包的两张卡，永远不许消失、也不许被豁免掉。 */
const FROZEN = ['flash-lean-ptc-v3', 'flash-lean-ptc-v3-balance'];

function idsInText(text) {
  const out = [];
  for (const m of text.matchAll(ID_RE)) out.push(m[1]);
  return out;
}

let tags = [];
try {
  tags = execFileSync('git', ['tag', '-l', '--sort=v:refname'], { cwd: repo, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);
} catch (error) {
  console.error('✖ 无法读取 git tag（' + String(error && error.message ? error.message : error) + '）');
  console.error('  这个闸门靠「历史上发布过的 id」判定，没有 tag 就无从判定 —— 拒绝给出虚假的绿灯。');
  process.exit(2);
}
if (tags.length === 0) {
  console.error('✖ 仓库里没有任何 tag：无法判定历史兼容性（浅克隆请先 git fetch --tags）。');
  console.error('  这是 0.2.9 之前的旧行为：没有 tag 时静默通过，等于闸门从来不生效（第五轮审计 T1-3）。');
  process.exit(2);
}

const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
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

// 「有定义」必须是「随包发出去的定义」：仓库里放一份不随包的 yml，用户装上照样解析不到（第六轮 U2-3）。
// 判据取 package.json 的 files 白名单（它才是 npm 真正打包的范围）。
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
const current = new Set();
const collectYaml = (p) => {
  if (!fs.existsSync(p)) return;
  if (fs.statSync(p).isDirectory()) {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      collectYaml(path.join(p, e.name));
    }
    return;
  }
  if (!/\.ya?ml$/.test(p)) return;
  for (const id of idsInText(fs.readFileSync(p, 'utf8'))) current.add(id);
};
for (const f of (pkg.files || [])) collectYaml(path.join(repo, f));

// 冻结 id 必须来自 presets/*.patch.yml 这个「源」，光在合成出来的 cordis.patch.yml 里出现不算：
// 否则删掉一个源文件时，脚本会因为陈旧产物而假装通过（compose --check 会拦，但那是另一道闸门）。
const sourceIds = new Set();
for (const id of idsInText(fs.readdirSync(path.join(repo, 'presets'))
  .filter((f) => /\.ya?ml$/.test(f) && !/\.bak|disabled|\.removed/.test(f))
  .map((f) => fs.readFileSync(path.join(repo, 'presets', f), 'utf8')).join('\n'))) sourceIds.add(id);
const bundle = path.join(repo, 'cordis.patch.yml');
// 别名层丢掉 = 旧会话在插件卡形态下也解析不了，这是 0.2.8 → 0.2.9 想消灭的事故本身（第六轮 U2-3）。
const aliasRowRe = /name:\s*['"]dsh-flash-presets\/alias['"]/;
if (fs.existsSync(bundle) && !aliasRowRe.test(fs.readFileSync(bundle, 'utf8'))) {
  failures.push('cordis.patch.yml 缺少 flash-presets-alias 行（旧 id 将无法解析）');
}
const exportsMap = (pkg && pkg.exports) || {};
if (!(exportsMap['./alias'] && exportsMap['./alias'].default)) failures.push('package.json 缺少 exports["./alias"]');
if (!fs.existsSync(path.join(repo, 'lib', 'alias-plugin.js'))) failures.push('缺少 lib/alias-plugin.js');
if (fs.existsSync(bundle)) for (const id of idsInText(fs.readFileSync(bundle, 'utf8'))) current.add(id);

const excPath = path.join(repo, 'presets', 'compat-exceptions.json');
let exceptions = {};
try {
  exceptions = fs.existsSync(excPath) ? JSON.parse(fs.readFileSync(excPath, 'utf8')) : {};
} catch (error) {
  console.error('✖ presets/compat-exceptions.json 不是合法 JSON：' + String(error.message));
  process.exit(1);
}

// 运行时 alias 层（lib/preset-alias.js + presets/legacy-preset-map.json）：旧 id 在解析时映射到 canonical。
const mapPath = path.join(repo, 'presets', 'legacy-preset-map.json');
let aliasDoc = { canonical: '', aliases: {} };
try {
  aliasDoc = fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, 'utf8')) : { canonical: '', aliases: {} };
} catch (error) {
  console.error('✖ presets/legacy-preset-map.json 不是合法 JSON：' + String(error.message));
  process.exit(1);
}
const aliases = aliasDoc.aliases && typeof aliasDoc.aliases === 'object' ? aliasDoc.aliases : {};

const aliasKeysEarly = Object.keys(aliases).filter((k) => !k.startsWith('$'));
const failures = [];
if (typeof aliasDoc.canonical !== 'string' || !current.has(aliasDoc.canonical)) {
  failures.push('alias 表的 canonical 必须是当前仓库里真实定义过的 id，实际：' + String(aliasDoc.canonical));
}
for (const id of FROZEN) {
  if (!sourceIds.has(id)) failures.push('冻结 id 必须在 presets/*.patch.yml 里有定义（合成产物里的行不算）：' + id);
  if (Object.prototype.hasOwnProperty.call(aliases, id)) failures.push('冻结 id 不能出现在别名表里（它本身就是定义）：' + id);
  if (exceptions && Object.prototype.hasOwnProperty.call(exceptions, id)) failures.push('冻结 id 不能登记例外：' + id);
}
for (const key of Object.keys(aliases)) {
  if (key.startsWith('$')) continue;
  const entry = aliases[key];
  if (entry === null || typeof entry !== 'object' || typeof entry.rulesDiffer !== 'boolean') {
    failures.push('别名表条目必须是 { since, rulesDiffer: boolean, note? }：' + key);
  }
  if (key === aliasDoc.canonical) failures.push('别名不能指向自身：' + key);
  if (current.has(key)) failures.push('别名 id 同时还有定义（别名为死代码，容易误判）：' + key);
}

const exceptionsUsed = [];
for (const key of Object.keys(exceptions)) {
  if (key.startsWith('$')) continue;
  const entry = exceptions[key];
  const bad = entry === null || typeof entry !== 'object'
    || typeof entry.reason !== 'string' || entry.reason.trim() === ''
    || typeof entry.fallback !== 'string' || entry.fallback.trim() === ''
    || typeof entry.since !== 'string' || entry.since.trim() === '';
  if (bad) { failures.push('例外的值是 { reason, fallback, since } 且三项都要非空：' + key); continue; }
  if (!history.has(key)) failures.push('例外登记的 id 从未在历史 tag 里出现过（假账，删掉）：' + key);
  if (aliasKeysEarly.includes(key)) failures.push('同一 id 既在别名表又在例外表（别名优先，例外是假账，删掉）：' + key);
  if (current.has(key)) failures.push('例外登记的 id 现在有定义（例外多余，删掉）：' + key);
  exceptionsUsed.push(key);
}

const aliasKeys = Object.keys(aliases).filter((k) => !k.startsWith('$'));
const missing = [];
for (const [id, where] of [...history.entries()].sort()) {
  if (current.has(id) || exceptionsUsed.includes(id) || aliasKeys.includes(id)) continue;
  missing.push({ id, last: where[where.length - 1], n: where.length });
}

console.log('历史 tag（' + tags.length + '）：' + tags.join(', '));
console.log('历史定义过的 preset id（' + history.size + '）：' + [...history.keys()].sort().join(', '));
console.log('当前仓库定义的 id：' + [...current].sort().join(', '));
console.log('alias 表（' + aliasKeys.length + ' 个历史 id → ' + String(aliasDoc.canonical) + '）：' + aliasKeys.sort().join(', '));
console.log('例外表（' + exceptionsUsed.length + '）：' + (exceptionsUsed.length ? exceptionsUsed.sort().join(', ') : '（空）'));
for (const f of failures) console.log('✖ ' + f);
if (failures.length > 0) process.exit(1);
if (missing.length) {
  console.log('');
  console.log('✖ 以下 id 历史上发布过、现在没有定义，也没有登记例外：');
  for (const m of missing) console.log('   ' + m.id + '   （最后出现于 ' + m.last + '，共 ' + m.n + ' 个版本）');
  console.log('');
  console.log('修法三选一：① 在 presets/ 补一个同内容的定义；② 加进 presets/legacy-preset-map.json 的 aliases（推荐：零数据风险、不进 picker）；③ 在 presets/compat-exceptions.json 登记 reason + fallback + since');
  process.exit(1);
}
console.log('✓ 历史上出现过的 preset id 全部仍可解析（定义 / 别名 / 登记例外三者之一）');
