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
    return text.slice(m.index + m[0].length).replace(/\s+$/, '');
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

let raw = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, 'utf8') : '[]\n';
const eol = detectEol(raw);
const isEmptyArray = s => /^\[\s*\]$/.test(s.trim());

let out;
try {
  raw = stripBlock(raw);
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
if (flag('--check')) {
  console.log('将写入的预设行: ' + (rows.length ? rows.join(', ') : '（无）'));
  process.exit(0);
}
fs.mkdirSync(path.dirname(path.resolve(patchPath)), { recursive: true });
fs.writeFileSync(patchPath, out, 'utf8');
console.log('预设行: ' + (rows.length ? rows.join(', ') : '（无）'));
