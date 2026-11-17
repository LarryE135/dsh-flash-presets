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

// 从一条预设正文里取出它的 preset id（"- id: preset-xxx"）。
function idOfBody(body) {
  const m = /^\s*-\s*id:\s*(preset-\S+)\s*(?:#.*)?$/m.exec(String(body));
  return m === null ? '' : m[1];
}

// opts.skipIds：用户改过的那几条 id —— 不再写我们的一份，否则同 id 会有两张卡。
function buildBlock(eol = '\n', opts = {}) {
  const skip = opts.skipIds instanceof Set ? opts.skipIds : new Set(opts.skipIds || []);
  const bodies = FILES.map(name => {
    const file = path.join(presetsDir, name);
    if (!fs.existsSync(file)) throw new Error('缺少预设文件: ' + file);
    const text = fs.readFileSync(file, 'utf8');
    const m = /^- insert:\n/m.exec(text);            // 只认行首的 - insert:（注释里也有这个词）
    if (!m) throw new Error(name + ': 找不到行首的 - insert: 条目');
    // 落盘前把 !!js 平台标签解成布尔：用户机器上的补丁必须是普通 YAML
    return resolvePlatformTags(text.slice(m.index + m[0].length).replace(/\s+$/, ''));
  }).filter((body) => !skip.has(idOfBody(body)));
  if (opts.legacyLite === true) {
    const lite = buildLiteCompatBody();
    if (!skip.has(idOfBody(lite))) bodies.push(lite);
  }
  if (bodies.length === 0) return '';   // 全被 skipIds 跳过：不写空块，写出来是 insert: null
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

// 安装器真正写过的行：v3、balance，以及升级时才补的 -lite 兼容行。
// v1 / v2 是 0.2.5 及更早的孤立行，0.2.6 起安装器不再写它们 —— 那是用户照 README 自己加回来的，
// 认领等于静默删除（第六轮审计 U1-2）。
const INSTALLER_IDS = new Set(['preset-flash-lean-ptc-v3', 'preset-flash-lean-ptc-v3-balance', 'preset-flash-lean-ptc-v3-lite']);

// 去行尾空白、去空行、抹掉公共缩进：用户复制粘贴常改缩进，语义一样就不该算「改过」。
function normalizeEntry(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '');
  let min = Infinity;
  for (const l of lines) min = Math.min(min, l.match(/^(\s*)/)[1].length);
  if (!Number.isFinite(min)) return '';
  return lines.map((l) => l.slice(min)).join('\n');
}

// 按「- id: preset-xxx」切条目（indent 是条目行的缩进），返回 [{ id, text }]。
function splitEntries(lines, indent) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)-\s*id:\s*(\S+)\s*(?:#.*)?$/);
    if (!m || m[1].length !== indent) continue;
    const chunks = [lines[i]];
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === '' || lines[j].match(/^(\s*)/)[1].length > indent)) {
      chunks.push(lines[j]);
      j++;
    }
    out.push({ id: m[2], text: chunks.join('\n') });
    i = j - 1;
  }
  return out;
}

// 安装器自己会写进去的每一条（按 id 索引）。认领前拿它做逐行比对 ——
// 这是本轮 P1：只比结构的话，用户把 thresholdRatio 改成 0.9 的条目也「结构相符」，
// 于是被当成残留删掉，还打印「内容与安装器写入的一致」（实测复现）。
let installerEntries = null;
function installerEntryMap() {
  if (installerEntries !== null) return installerEntries;
  const map = new Map();
  const block = buildBlock('\n', { legacyLite: keepLegacyLite === true });
  for (const e of splitEntries(block.split('\n'), 4)) map.set(e.id, normalizeEntry(e.text));
  installerEntries = map;
  return map;
}

// 判据分两层（第六轮审计 U1-2 + 第三轮自查 P1-1）：
//   ① 结构：包装行 + config.id 与 id 对应；
//   ② 内容：用户这一条里的**每一行**都必须是安装器也会写的那一行 —— 只要有一行是安装器不会写的
//      （比如把 thresholdRatio 从 0.25 改成 0.9），就认定「用户改过」，整条保留。
// 用子集而不是逐字相等，是因为老版本安装器写的条目更短（少几个键）；逐字相等会把那些历史条目
// 判成「用户自加」而留下两份同 id 的卡（selftest 的 -lite 升级用例正是这种情形）。
// 代价：用户手工**删掉**某个键时，会被当作老安装器的短条目而补齐 —— 这是无法区分的，取不重复。
function entryLineSet(text) {
  return new Set(normalizeEntry(text).split('\n').map((l) => l.replace(/\s+/g, ' ')));
}

function isInstallerEntry(id, text) {
  if (!INSTALLER_IDS.has(id)) return false;
  const bare = id.replace(/^preset-/, '');
  const body = String(text);
  if (!/^\s*name:\s*'@deepseek-ai\/dsh-agent-preset'\s*$/m.test(body)) return false;
  if (!new RegExp('^\\s*id:\\s*' + bare + '\\s*$', 'm').test(body)) return false;
  const expect = installerEntryMap().get(id);
  if (expect === undefined) return false;
  const theirs = entryLineSet(expect);
  for (const line of entryLineSet(body)) if (!theirs.has(line)) return false;
  return true;
}

const lead = (s) => (s.match(/^\s*/) || [''])[0].length;
const isCommentLine = (s) => s.trimStart().startsWith('#');

// 条目（从 start 行、缩进 indent 开始）的最后一个非空行号。
// 关键：条目内部可能有空行（v3 的 suffix: |- 里就有一个）。以前「遇空行即结束」会把
// 199 行的条目截成 13 行 —— 13 行前缀必然全在安装器行集里，于是判成「安装器写的」，
// 删掉前 13 行、后面 176 行成孤儿，卸载路径还会静默写出非法 YAML（第四轮审计 P0）。
function entryRange(lines, start, indent) {
  let end = start;
  let j = start + 1;
  while (j < lines.length) {
    const raw = lines[j].replace(/\n$/, '');
    if (raw.trim() === '') {
      let k = j + 1;
      while (k < lines.length && lines[k].trim() === '') k++;
      if (k < lines.length && lead(lines[k].replace(/\n$/, '')) > indent) { j = k; continue; }
      break;
    }
    if (lead(raw) <= indent) break;
    end = j;
    j++;
  }
  return end;
}

/**
 * 认领托管块之外的历史残留：老安装方式（写裸行、或手工粘贴）留下的
 * `- id: preset-flash-lean-ptc-vN` 条目不会被 stripBlock 识别，重复安装就会变成两份。
 * 这里把它们整条摘掉（只摘"整条都由我们的预设行组成"的条目，别人的行一个不碰），
 * 随后由托管块统一重建 —— 结果就是"装几次都只有一份"。
 *
 * 第四轮审计后的两条硬约束：
 *   ① 条目边界按「缩进归零」算，不按「第一个空行」算；
 *   ② `- insert:` 数组里逐条摘，不再整数组摘 —— 别人的条目、数组内的注释都保住。
 */
function adoptForeignRows(text) {
  const lines = text.split(/(?<=\n)/);
  const bare = (i) => lines[i].replace(/\n$/, '');
  const drop = new Set();
  const removed = [];
  const kept = [];
  const adoptOne = (start, indent, id) => {
    const end = entryRange(lines, start, indent);
    if (!isInstallerEntry(id, lines.slice(start, end + 1).join(''))) {
      if (/^preset-flash-lean-ptc/.test(id)) kept.push(id);
      return false;
    }
    removed.push(id);
    for (let k = start; k <= end; k++) drop.add(k);
    return true;
  };
  let i = 0;
  while (i < lines.length) {
    const line = bare(i);
    if (/^-\s*insert:\s*(?:#.*)?$/.test(line)) {
      let j = i + 1;
      const bodyIdx = [];
      while (j < lines.length && !/^-\s/.test(bare(j))) { bodyIdx.push(j); j++; }
      const starts = bodyIdx.filter((k) => /^\s*-\s*id:\s*\S+/.test(bare(k)));
      if (starts.length > 0) {
        const minIndent = Math.min(...starts.map((k) => lead(bare(k))));
        let touched = false;
        for (const k of starts) {
          if (lead(bare(k)) !== minIndent) continue;
          const m = bare(k).match(/^\s*-\s*id:\s*(\S+)\s*(?:#.*)?$/);
          if (m && adoptOne(k, minIndent, m[1])) touched = true;
        }
        const survives = bodyIdx.filter((k) => !drop.has(k) && bare(k).trim() !== '');
        if (touched && !survives.some((k) => /^\s*-\s/.test(bare(k)))) {
          // 数组里只剩注释（或什么都不剩）：摘掉 - insert: 行本身；注释提到顶层，不连坐删除
          drop.add(i);
          for (const k of survives) {
            if (isCommentLine(bare(k))) lines[k] = bare(k).trimStart() + '\n';
          }
        }
      }
      i = j;
      continue;
    }
    const m = /^-\s*id:\s*(\S+)\s*(?:#.*)?$/.exec(line);
    if (m) {
      adoptOne(i, 0, m[1]);
      i = entryRange(lines, i, 0) + 1;
      continue;
    }
    i++;
  }
  return { text: lines.filter((_, k) => !drop.has(k)).join(''), removed, kept };
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
// 写盘前的结构闸：顶层只能是块状数组（每个顶层行都以 "- " 开头）或 "[]"。
// 卸载路径以前没有任何兜底 —— 半条残留会被静默写回，profile 直接起不来（第四轮审计 P0）。
const looksLikeYamlArray = (s) => {
  const rows = s.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'));
  if (rows.length === 0) return true;
  if (rows.length === 1 && isEmptyArray(rows[0])) return true;
  for (const line of rows) {
    if (/^\s/.test(line)) continue;                      // 缩进行属于上一条目
    if (/^\[\s*\]$/.test(line.trim())) return false;     // "[]" 后面还跟着内容
    if (!/^-(?:\s|$)/.test(line)) return false;          // 顶层出现非数组行
  }
  return true;
};

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
    const block = buildBlock(eol, { legacyLite: keepLegacyLite, skipIds: new Set(keptCustom) });
    if (body.length === 0 || (body.length === 1 && isEmptyArray(body[0]))) {
      const kept = raw.split(/\r?\n/).filter(l => !isEmptyArray(l)).join(eol).replace(/\s+$/, '');
      out = (kept.trim() ? kept + eol + eol : '') + block;
      if (out.trim() === '') out = '[]' + eol;   // 全被 skipIds 跳过时别写出空文件
    } else if (body[0].trimStart().startsWith('- ')) {
      out = block === '' ? raw.replace(/\s+$/, '') + eol : raw.replace(/\s+$/, '') + eol + eol + block;
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

if (!flag('--check') && !looksLikeYamlArray(out)) {
  console.error('✖ 生成的结果不是块状数组 YAML，已中止（未写入任何内容）。');
  console.error('  请备份该文件后贴到 issue 里 —— 这类损坏我们宁可拒绝，也不写半个文件。');
  process.exit(3);
}

const rows = [...out.matchAll(/^\s+- id: (preset-\S+)\s*(?:#.*)?$/gm)].map(m => m[1]);
if (adopted.length > 0) {
  console.log('已认领托管块外的历史残留: ' + adopted.join(', ') + '（内容与安装器写入的一致，已由托管块取代）');
}
if (keptCustom.length > 0) {
  const managed = keptCustom.filter((id) => /^preset-flash-lean-ptc-v3(-balance|-lite)?$/.test(id));
  const foreign = keptCustom.filter((id) => !managed.includes(id));
  if (managed.length > 0) {
    console.log('你改过这几条 → 本次不覆盖、也不另写一份（同 id 只留你的）：' + managed.join(', '));
  }
  if (foreign.length > 0) {
    console.log('已保留你自己加的预设行: ' + foreign.join(', ') + '（不在安装器管理的 id 内；不动它）');
  }
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
