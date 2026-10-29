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
import { resolvePlatformTags } from '../lib/platform-tags.mjs';

const BEGIN = '# >>> dsh-flash-presets: managed block (0.1.7+ plugin-row presets) >>>';
const END = '# <<< dsh-flash-presets: managed block <<<';
const FILES = ['flash-lean-ptc-v1.patch.yml', 'flash-lean-ptc-v2.patch.yml', 'flash-lean-ptc-v3.patch.yml'];

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

function buildBlock(eol = '\n') {
  const bodies = FILES.map(name => {
    const file = path.join(presetsDir, name);
    if (!fs.existsSync(file)) throw new Error('缺少预设文件: ' + file);
    const text = fs.readFileSync(file, 'utf8');
    const m = /^- insert:\n/m.exec(text);            // 只认行首的 - insert:（注释里也有这个词）
    if (!m) throw new Error(name + ': 找不到行首的 - insert: 条目');
    // 落盘前把 !!js 平台标签解成布尔：用户机器上的补丁必须是普通 YAML
    return resolvePlatformTags(text.slice(m.index + m[0].length).replace(/\s+$/, ''));
  });
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
const OUR_ROW = /^preset-flash-lean-ptc-v[0-9]+$/;

function adoptForeignRows(text) {
  const lines = text.split(/(?<=\n)/);
  const out = [];
  const removed = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^-\s*insert:\s*$/.test(line)) {
      let j = i + 1;
      const body = [];
      while (j < lines.length && !/^-\s/.test(lines[j])) { body.push(lines[j]); j++; }
      // 只认"直接子行"（同一缩进层）——预设条目里还嵌着 persona/tool-fs 等二级 id，
      // 把它们也算进来就会永远判定为"别人的条目"
      const hits = body
        .map(l => l.match(/^(\s*)-\s*id:\s*(\S+)\s*$/))
        .filter(Boolean)
        .map(m => ({ indent: m[1].length, id: m[2] }));
      const minIndent = hits.length > 0 ? Math.min(...hits.map(h => h.indent)) : Infinity;
      const ids = hits.filter(h => h.indent === minIndent).map(h => h.id);
      if (ids.length > 0 && ids.every(id => OUR_ROW.test(id))) {
        removed.push(...ids);
        while (j < lines.length && lines[j].trim() === '') j++;
        i = j;
        continue;
      }
    } else {
      const m = line.match(/^-\s*id:\s*(\S+)\s*$/);
      if (m && OUR_ROW.test(m[1])) {
        removed.push(m[1]);
        i++;
        while (i < lines.length && /^\s+\S/.test(lines[i])) i++;
        while (i < lines.length && lines[i].trim() === '') i++;
        continue;
      }
    }
    out.push(line);
    i++;
  }
  return { text: out.join(''), removed };
}

let raw = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, 'utf8') : '[]\n';
const eol = detectEol(raw);
const isEmptyArray = s => /^\[\s*\]$/.test(s.trim());

let out;
let adopted = [];
try {
  raw = stripBlock(raw);
  const adopt = adoptForeignRows(raw);
  raw = adopt.text;
  adopted = adopt.removed;
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
      out = (kept.trim() ? kept + eol + eol : '') + buildBlock(eol);
    } else if (body[0].trimStart().startsWith('- ')) {
      out = raw.replace(/\s+$/, '') + eol + eol + buildBlock(eol);
    } else {
      console.error('✖ 该补丁文件不是「块状数组」形式（可能是 [{...}] 之类的流式写法）。');
      console.error('  请先改成块状数组，或用 --legacy 安装旧式目录预设。');
      process.exit(3);
    }
  }
} catch (e) {
  console.error('✖ ' + e.message);
  process.exit(1);
}

const rows = [...out.matchAll(/^\s+- id: (preset-\S+)$/gm)].map(m => m[1]);
if (adopted.length > 0) {
  console.log('已认领托管块外的历史残留: ' + adopted.join(', ') + '（旧安装方式留下的裸行，已并入托管块）');
}
if (flag('--check')) {
  console.log('将写入的预设行: ' + (rows.length ? rows.join(', ') : '（无）'));
  process.exit(0);
}
fs.mkdirSync(path.dirname(path.resolve(patchPath)), { recursive: true });
fs.writeFileSync(patchPath, out, 'utf8');
console.log('预设行: ' + (rows.length ? rows.join(', ') : '（无）'));
