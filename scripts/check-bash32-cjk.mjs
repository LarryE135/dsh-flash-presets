#!/usr/bin/env node
// 守卫：bash 3.2（macOS 自带）解析 `$VAR（` 时会把全角字符并进变量名，导致取值失败
// （配 set -u 直接 unbound variable）。凡全角字符紧跟 `$变量` 的写法，一律要写成 `${变量}`。
// 只扫 shell 语义的文件（*.sh / *.bash），并跳过注释行与行内注释之后的部分；
// 不扫 *.ps1 —— PowerShell 的变量名解析不受此影响。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['.git', 'node_modules', 'dist']);
const BAD = /\$[A-Za-z_][A-Za-z_0-9]*(?![A-Za-z_0-9{])[^\x00-\x7F]/g;

const hits = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(sh|bash)$/.test(e.name)) scan(p);
  }
}
function scan(p) {
  fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
    const hash = line.indexOf('#');
    const code = hash === -1 ? line : line.slice(0, hash);   // 注释部分不检查
    BAD.lastIndex = 0;
    let m;
    while ((m = BAD.exec(code)) !== null) {
      hits.push(p.slice(ROOT.length + 1) + ':' + (i + 1) + '  ' + m[0]);
    }
  });
}

walk(ROOT);
if (!hits.length) {
  console.log('OK: shell 脚本里没有 $VAR 紧跟全角字符的写法（macOS bash 3.2 安全）');
  process.exit(0);
}
console.error('✖ 以下写法在 macOS 自带 bash 3.2 上会解析错（全角字符被并进变量名）：');
for (const h of hits) console.error('  ' + h);
console.error('修法：加花括号，例如 $p（ -> ${p}（');
process.exit(1);
