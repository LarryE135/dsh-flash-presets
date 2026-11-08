#!/usr/bin/env node
/**
 * Insert / replace / remove the Flash 精简 preset block in a DSH profile patch file.
 *
 * One implementation shared by scripts/install.sh and scripts/install.ps1 — Node is
 * always present for a DSH user, Python may not be (especially on Windows).
 *
 *   node scripts/merge-presets.mjs --patch <cordis.patch.yml>
 *   node scripts/merge-presets.mjs --patch <cordis.patch.yml> --remove
 *   node scripts/merge-presets.mjs --patch <cordis.patch.yml> --check
 *
 * Exit codes: 0 = ok, 3 = patch file is not a block-style YAML array, 1 = usage/IO error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePlatformTags } from './platform-tags.mjs';

const BEGIN = '# >>> dsh-flash-presets: managed block (0.1.7+ plugin-row presets) >>>';
const END = '# <<< dsh-flash-presets: managed block <<<';
const ALL_FILES = ['flash-lean-ptc-v3.patch.yml', 'flash-lean-ptc-v3-balance.patch.yml'];
// --only a,b：只合并指定预设（0.2.5 起默认只装 v3，安装器会显式指定）
const onlyArg = (() => {
  const i = process.argv.indexOf('--only');
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return typeof v === 'string' && v.length > 0 && !v.startsWith('--') ? v : null;
})();
const FILES = onlyArg === null
  ? ALL_FILES
  : onlyArg.split(',').map(s => s.trim()).filter(Boolean).map(id => (id.endsWith('.patch.yml') ? id : id + '.patch.yml'));

const here = path.dirname(fileURLToPath(import.meta.url)); // never URL.pathname on Windows
const argv = process.argv.slice(2);
const opt = (name, dflt = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const flag = name => argv.includes(name);

const patchPath = opt('--patch');
if (!patchPath) {
  console.error('用法: node scripts/merge-presets.mjs --patch <cordis.patch.yml> [--presets-dir <dir>] [--remove] [--check]');
  process.exit(1);
}
const presetsDir = path.resolve(opt('--presets-dir', path.join(here, '..', 'presets')));

function detectEol(s) {
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf = (s.match(/(?<!\r)\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}

/**
 * 0.2.6–0.2.8 的脚本安装会把 id 写成 flash-lean-ptc-v3-lite；0.2.9 起这个 id 不在补丁里，
 * 而脚本安装这条路没有别名层，那些会话就会 not-found（第五轮审计 T0-1）。
 * 所以升级时若发现旧块里有 -lite，就额外写一行「兼容行」：规则与 v3 相同、order 放到 99、
 * 名字标「勿选」。全新安装（旧块里没有 -lite）不会多这一行。
 */
function buildLiteCompatBody() {
  const src = path.join(presetsDir, 'flash-lean-ptc-v3.patch.yml');
  if (!fs.existsSync(src)) throw new Error('缺少兼容行源文件: ' + src);
  const text = fs.readFileSync(src, 'utf8');
  const m = /^- insert:\n/m.exec(text);
  if (!m) throw new Error('flash-lean-ptc-v3.patch.yml: 找不到行首的 - insert: 条目');
  let body = resolvePlatformTags(text.slice(m.index + m[0].length).replace(/\s+$/, ''));
  const before = body;
  body = body.replace(/^(\s*)- id: preset-flash-lean-ptc-v3\s*$/m, '$1- id: preset-flash-lean-ptc-v3-lite');
  body = body.replace(/^(\s*)id: flash-lean-ptc-v3\s*$/m, '$1id: flash-lean-ptc-v3-lite');
  body = body.replace(/^(\s*)name: "精简·PTC v3（lean-v3）"\s*$/m, '$1name: "兼容行 · 旧 lite 会话（flash-lean-ptc-v3-lite，勿选）"');
  body = body.replace(/^(\s*)order: 27\s*$/m, '$1order: 99');
  // 描述不能照抄 v3 的（这一行的 id 是 -lite）：写成它真正的用途
  body = body.replace(/^(\s*)description: ".*"\s*$/m, '$1description: "兼容行：只为了让旧 lite 会话还能打开，规则与 精简·PTC v3 相同；新建会话请选「精简·PTC v3（lean-v3）」。"');
  if (body === before || !body.includes('flash-lean-ptc-v3-lite')) throw new Error('兼容行生成失败：v3 源文件的结构变了');
  return body;
}

function buildBlock(eol = '\n', opts = {}) {
  const bodies = FILES.map(name => {
    const file = path.join(presetsDir, name);
    if (!fs.existsSync(file)) throw new Error('缺少预设文件: ' + file);
    const text = fs.readFileSync(file, 'utf8');
    const m = /^- insert:\n/m.exec(text);            // 只认行首的 - insert:（注释里也有这个词）
    if (!m) throw new Error(name + ': 找不到行首的 - insert: 条目');
    // 落盘前把 !!js 平台标签解成布尔：用户机器上的补丁必须是普通 YAML
    return resolvePlatformTags(text.slice(m.index + m[0].length).replace(/\s+$/, ''));
  });
  if (opts.legacyLite === true) bodies.push(buildLiteCompatBody());
  return (BEGIN + '\n- insert:\n' + bodies.join('\n') + '\n' + END + '\n').replace(/\n/g, eol);
}

function stripBlock(raw) {
  let skip = false;
  let open = false;
  const out = [];
  for (const line of raw.split(/(?<=\n)/)) {
    if (line.trim() === BEGIN) {
      if (open) throw new Error('托管块嵌套或重复：BEGIN 标记出现两次且未闭合');
      open = true;
      skip = true;
      // 安装时我们在块前留了一个空行做间隔，卸载时一并去掉，才能逐字节还原
      if (out.length && out[out.length - 1].trim() === '') out.pop();
      continue;
    }
    const keep = !skip;
    if (line.trim() === END) { skip = false; open = false; }
    if (keep) out.push(line);
  }
  if (open) throw new Error('托管块缺少结束标记（' + END + '），已中止，避免误删文件其余内容');
  return out.join('');
}

/**
 * 认领托管块之外的历史残留：老安装方式（写裸行、或手工粘贴）留下的
 * `- id: preset-flash-lean-ptc-vN` 条目不会被 stripBlock 识别，重复安装就会变成两份。
 * 这里把它们整条摘掉（只摘"整条都由我们的预设行组成"的条目，别人的行一个不碰），
 * 随后由托管块统一重建 —— 结果就是"装几次都只有一份"。
 */
// 安装器真正写过的行：v3、balance，以及升级时才补的 -lite 兼容行。
// v1 / v2 是 0.2.5 及更早的孤立行，0.2.6 起安装器不再写它们 —— 那是用户照 README 自己加回来的，
// 认领等于静默删除（第六轮审计 U1-2）。
const INSTALLER_IDS = new Set(['preset-flash-lean-ptc-v3', 'preset-flash-lean-ptc-v3-balance', 'preset-flash-lean-ptc-v3-lite']);

// 认领前先比对结构：必须是「preset-<id> 包装行 + config.id 与之一致」的完整预设条目；
// 对不上（用户改过，或从旧版本整段拷来）就原样保留，并如实说明。
function isInstallerRow(presetId, blockText) {
  if (!INSTALLER_IDS.has(presetId)) return false;
  const id = presetId.replace(/^preset-/, '');
  const hasWrap = /^\s*name:\s*'@deepseek-ai\/dsh-agent-preset'\s*$/m.test(blockText);
  const hasConfig = new RegExp('^\\s*id:\\s*' + id + '\\s*$', 'm').test(blockText);
  return hasWrap && hasConfig;
}

function adoptForeignRows(text) {
  const lines = text.split(/(?<=\n)/);
  const out = [];
  const removed = [];
  const kept = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^-\s*insert:\s*$/.test(line)) {
      let j = i + 1;
      const body = [];
      while (j < lines.length && !/^-\s/.test(lines[j])) { body.push(lines[j]); j++; }
      const hits = body
        .map(l => l.match(/^(\s*)-\s*id:\s*(\S+)\s*$/))
        .filter(Boolean)
        .map(m => ({ indent: m[1].length, id: m[2] }));
      const minIndent = hits.length > 0 ? Math.min(...hits.map(h => h.indent)) : Infinity;
      const ids = hits.filter(h => h.indent === minIndent).map(h => h.id);
      if (ids.length > 0 && ids.every(id => isInstallerRow(id, body.join('')))) {
        removed.push(...ids);
        while (j < lines.length && lines[j].trim() === '') j++;
        i = j;
        continue;
      }
    } else {
      const m = line.match(/^-\s*id:\s*(\S+)\s*$/);
      if (m) {
        const blockLines = [line];
        let j = i + 1;
        while (j < lines.length && /^\s+\S/.test(lines[j])) { blockLines.push(lines[j]); j++; }
        if (isInstallerRow(m[1], blockLines.join(''))) {
          removed.push(m[1]);
          i = j;
          while (i < lines.length && lines[i].trim() === '') i++;
          continue;
        }
        if (/^preset-flash-lean-ptc/.test(m[1])) kept.push(m[1]);
      }
    }
    out.push(line);
    i++;
  }
  return { text: out.join(''), removed, kept };
}

let raw = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, 'utf8') : '[]\n';
const eol = detectEol(raw);
// 旧托管块 / 旧裸行里出现过 -lite → 这次升级要带一行兼容行（除非显式 --no-legacy-lite）
const hadLegacyLite = /preset-flash-lean-ptc-v3-lite/.test(raw);
const keepLegacyLite = hadLegacyLite && !flag('--no-legacy-lite');
if (hadLegacyLite) {
  console.log(keepLegacyLite
    ? '检测到旧安装写过 flash-lean-ptc-v3-lite：本次会额外写一行兼容行（脚本安装没有别名层，否则那些会话会打不开）'
    : '检测到旧安装写过 flash-lean-ptc-v3-lite，但已按 --no-legacy-lite 跳过兼容行');
}
const isEmptyArray = s => /^\[\s*\]$/.test(s.trim());

// issue #25：脚本路径是整块替换旧托管块 —— 0.2.5 时代的三卡（v1/v2/v3）会被换成两张卡，
// 而这条路径没有别名层，引用被移除 id 的旧会话会打不开。安装前先把「会被丢掉哪些」记下来。
const droppedLegacy = ['flash-lean-ptc-v1', 'flash-lean-ptc-v2']
  .filter((id) => new RegExp('preset-' + id + '(?![\\w-])').test(raw));
let out;
let adopted = [];
let keptCustom = [];
try {
  raw = stripBlock(raw);
  const adopt = adoptForeignRows(raw);
  raw = adopt.text;
  adopted = adopt.removed;
  keptCustom = adopt.kept;
  if (flag('--remove')) {
    const body = raw.split(/\r?\n/).filter(l => l.trim() && !l.trimStart().startsWith('#'));
    if (body.length === 0) {
      const cmts = raw.split(/\r?\n/).filter(l => l.trim() && l.trimStart().startsWith('#')).join(eol);
      out = (cmts ? cmts.replace(/\s+$/, '') + eol : '') + '[]' + eol;
    } else {
      out = raw;                      // 原样保留用户原有内容与尾随空行
    }
  } else {
    const body = raw.split(/\r?\n/).filter(l => l.trim() && !l.trimStart().startsWith('#'));
    if (body.length === 0 || (body.length === 1 && isEmptyArray(body[0]))) {
      const kept = raw.split(/\r?\n/).filter(l => !isEmptyArray(l)).join(eol).replace(/\s+$/, '');
      out = (kept.trim() ? kept + eol + eol : '') + buildBlock(eol, { legacyLite: keepLegacyLite });
    } else if (body[0].trimStart().startsWith('- ')) {
      out = raw.replace(/\s+$/, '') + eol + eol + buildBlock(eol, { legacyLite: keepLegacyLite });
    } else {
      console.error('✖ 该补丁文件不是「块状数组」形式（可能是 [{...}] 之类的流式写法）。');
      console.error('  请先把这个文件改回块状数组（形如 `[]` 或 `- ...` 开头），再跑一次。');
      process.exit(3);
    }
  }
} catch (e) {
  console.error('✖ ' + e.message);
  process.exit(1);
}

const rows = [...out.matchAll(/^\s+- id: (preset-\S+)$/gm)].map(m => m[1]);
if (adopted.length > 0) {
  console.log('已认领托管块外的历史残留: ' + adopted.join(', ') + '（内容与安装器写入的一致，已由托管块取代）');
}
if (keptCustom.length > 0) {
  console.log('已保留你自己加的预设行: ' + keptCustom.join(', ') + '（不在安装器管理的 id 内，或内容被改过；不动它）');
}
if (flag('--check')) {
  console.log('将写入的预设行: ' + (rows.length ? rows.join(', ') : '（无）'));
  process.exit(0);
}
fs.mkdirSync(path.dirname(path.resolve(patchPath)), { recursive: true });
fs.writeFileSync(patchPath, out, 'utf8');
console.log('预设行: ' + (rows.length ? rows.join(', ') : '（无）'));

if (droppedLegacy.length > 0 && !flag('--remove')) {
  console.log('⚠ 旧托管块里还有 ' + droppedLegacy.join(' / ') + '：这次升级会移除它们。');
  console.log('  脚本安装没有旧 id 兜底（别名层只随插件卡发行）：引用这些 id 的旧会话会打不开。');
  console.log('  需要旧会话继续可打开，请改用插件卡安装：dsh plugin --profile <名称> add dsh-flash-presets');
}
