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
const FILES = ['flash-lean.patch.yml', 'flash-lean-ptc.patch.yml'];

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

function buildBlock() {
  const bodies = FILES.map(name => {
    const file = path.join(presetsDir, name);
    if (!fs.existsSync(file)) throw new Error('缺少预设文件: ' + file);
    const text = fs.readFileSync(file, 'utf8');
    const m = /^- insert:\n/m.exec(text);            // 只认行首的 - insert:（注释里也有这个词）
    if (!m) throw new Error(name + ': 找不到行首的 - insert: 条目');
    return text.slice(m.index + m[0].length).replace(/\s+$/, '');
  });
  return BEGIN + '\n- insert:\n' + bodies[0] + '\n' + bodies[1] + '\n' + END + '\n';
}

function stripBlock(raw) {
  let skip = false;
  return raw.split(/(?<=\n)/).filter(line => {
    if (line.trim() === BEGIN) skip = true;
    const keep = !skip;
    if (line.trim() === END) skip = false;
    return keep;
  }).join('');
}

let raw = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, 'utf8') : '[]\n';
raw = stripBlock(raw);

let out;
if (flag('--remove')) {
  out = raw;
} else {
  const body = raw.split(/\r?\n/).filter(l => l.trim() && !l.trimStart().startsWith('#'));
  if (body.length === 0 || (body.length === 1 && body[0].trim() === '[]')) {
    const kept = raw.split(/\r?\n/).filter(l => l.trim() !== '[]').join('\n').replace(/\s+$/, '');
    out = (kept.trim() ? kept + '\n\n' : '') + buildBlock();
  } else if (body[0].trimStart().startsWith('- ')) {
    out = raw.replace(/\s+$/, '') + '\n\n' + buildBlock();
  } else {
    console.error('✖ 该补丁文件不是「块状数组」形式（可能是 [{...}] 之类的流式写法）。');
    console.error('  请先改成块状数组，或用 --legacy 安装旧式目录预设。');
    process.exit(3);
  }
}

const rows = [...out.matchAll(/^\s+- id: (preset-\S+)$/gm)].map(m => m[1]);
if (flag('--check')) {
  console.log('将写入的预设行: ' + (rows.length ? rows.join(', ') : '（无）'));
  process.exit(0);
}
fs.mkdirSync(path.dirname(path.resolve(patchPath)), { recursive: true });
fs.writeFileSync(patchPath, out, 'utf8');
console.log('预设行: ' + (rows.length ? rows.join(', ') : '（无）'));
