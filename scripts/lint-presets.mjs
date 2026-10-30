#!/usr/bin/env node
/**
 * 预设文本审计：编号 / 缩进 / 规则自相矛盾 / 平台相关路径 / 版本引用漂移。
 * 纯本地、无网络，供 npm run verify 与 CI 使用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const warn = [];

function rel(p) { return path.relative(ROOT, p); }

// ---- 1. 规则结构 ------------------------------------------------------------
function parseRules(text) {
  const lines = text.split(/\r?\n/);
  const rules = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s+)(\d{1,2})\.\s+(.*)$/.exec(lines[i]);
    if (m) {
      if (cur) rules.push(cur);
      cur = { num: Number(m[2]), indent: m[1].length, line: i + 1, parts: [m[3]] };
      continue;
    }
    if (!cur) continue;
    if (lines[i].trim() === '') { rules.push(cur); cur = null; continue; }
    const ind = lines[i].length - lines[i].trimStart().length;
    if (ind >= cur.indent) cur.parts.push(lines[i].trim());
    else { rules.push(cur); cur = null; }
  }
  if (cur) rules.push(cur);
  return rules.map((r) => ({ ...r, body: r.parts.join(' ') }));
}

const BANNED = /\b(cat|head|tail|find|ls -r|sed -n)\b/i;
const USES = /\|\s*head\b|head\s+-\d+|tail\s+-\d+|\bcat\s+\S|\bfind\s+\S/;
const PLATFORM_PATHS = [['/tmp/', 'POSIX 专属临时目录'], ['C:\\', 'Windows 专属盘符'], ['/home/', '机器相关路径']];

for (const file of fs.readdirSync(path.join(ROOT, 'presets')).filter((f) => f.endsWith('.patch.yml'))) {
  const full = path.join(ROOT, 'presets', file);
  const rules = parseRules(fs.readFileSync(full, 'utf8'));
  if (rules.length === 0) { warn.push(f + ': 未解析到编号规则（若为故意留空可忽略）'); continue; }

  const nums = rules.map((r) => r.num);
  const expect = Array.from({ length: nums.length }, (_, i) => i + 1);
  if (nums.join() !== expect.join()) problems.push(file + ': 规则编号不连续 -> ' + nums.join(','));

  const baseIndent = Math.min(...rules.map((r) => r.indent));
  for (const r of rules) {
    if (r.indent !== baseIndent) problems.push(file + ': 规则 ' + r.num + ' 缩进 ' + r.indent + '，其余 ' + baseIndent + '（第 ' + r.line + ' 行）');
  }

  for (const r of rules) {
    const low = r.body.toLowerCase();
    const explicitlyAllows = /piping[^.]{0,40}head[^.]{0,20}fine|head[^.]{0,20}is fine/i.test(low);
    if (!explicitlyAllows && /never|no /.test(low) && BANNED.test(low)) {
      // 禁用词出现在使用之后同样矛盾：两个方向都查
      const other = rules.find((r2) => r2.num !== r.num && USES.test(r2.body));
      if (other) problems.push(file + ': 规则 ' + r.num + ' 禁用 shell 工具，规则 ' + other.num + ' 又使用 -> ' + other.body.slice(0, 70));
    }
    const portable = /%TEMP%|\$env:TEMP/i.test(r.body); // 同时给出 Windows 变体即视为可移植
    for (const [p, why] of PLATFORM_PATHS) {
      if (!r.body.includes(p)) continue;
      if (p === '/tmp/' && portable) continue;
      problems.push(file + ': 规则 ' + r.num + ' 含' + why + ' "' + p + '" -> ' + r.body.slice(0, 70));
    }
  }
}

// ---- 2. 版本引用漂移 --------------------------------------------------------
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;
// 允许引用「已发布版本」：仓库版本可能已升到未发布的下一个号，而文档里的安装/锁死命令
// 必须指向 npm 上真实可装的版本。publishedVersion 由维护者在发版时同步。
const PUBLISHED = pkg.publishedVersion || VERSION;
const ACCEPTED = new Set([VERSION, PUBLISHED]);
const DOCS = ['README.md', ...fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => 'docs/' + f)]
  .filter((f) => !/README-0\.\d+\.\d+\.md$/.test(f)); // 历史 README 保留旧版本号

for (const doc of DOCS) {
  const full = path.join(ROOT, doc);
  if (!fs.existsSync(full)) continue;
  const text = fs.readFileSync(full, 'utf8');
  for (const m of text.matchAll(/dsh-flash-presets(?:@|\^)?(\d+\.\d+\.\d+)(?![-\w])/g)) {
    if (!ACCEPTED.has(m[1])) problems.push(doc + ': 引用了 ' + m[1] + '，当前版本是 ' + VERSION + '、已发布版本是 ' + PUBLISHED + '（照抄会踩空）');
  }
  if (/^##+\s*未发布/m.test(text)) {
    problems.push(doc + ': 仍有「未发布」章节；若该版本已放弃发布，请删除或改标题');
  }
}

// ---- 2b. marketplace 清单版本断言 -------------------------------------------
// marketplace/plugin.json 的 version 靠人工同步，改漏不会被上面的文档扫描拦到（issue #16 第 8 项）。
const marketPath = path.join(ROOT, 'marketplace', 'plugin.json');
if (fs.existsSync(marketPath)) {
  try {
    const market = JSON.parse(fs.readFileSync(marketPath, 'utf8'));
    if (market.version !== VERSION) {
      problems.push('marketplace/plugin.json: version=' + market.version + '，与 package.json 的 ' + VERSION + ' 不一致');
    }
  } catch (error) {
    problems.push('marketplace/plugin.json: 无法解析（' + error.message + '）');
  }
}

// ---- 3. 白名单折叠 ----------------------------------------------------------
const allowPath = path.join(ROOT, 'scripts', 'lint-allowlist.json');
const allow = fs.existsSync(allowPath) ? JSON.parse(fs.readFileSync(allowPath, 'utf8')).entries ?? [] : [];
const kept = [];
for (const p of problems) {
  const hit = allow.find((a) => p.startsWith(a.file + ':') && p.includes(a.match));
  if (hit) warn.push(p + '  ［已登记：' + hit.reason + '］');
  else kept.push(p);
}
problems.length = 0;
problems.push(...kept);

// ---- 4. 输出 ----------------------------------------------------------------
for (const w of warn) console.log('⚠ ' + w);
if (problems.length === 0) {
  console.log('✓ 预设文本审计通过（' + VERSION + '）');
  process.exit(0);
}
for (const p of problems) console.error('✗ ' + p);
console.error('\n共 ' + problems.length + ' 个问题');
process.exit(1);
