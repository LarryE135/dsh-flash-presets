#!/usr/bin/env node
// fl-bash（Windows Bash 工具）随 dsh-flash-presets 一起发行：从 npm 装好 presets 就能在插件页打开 fl-bash 组件。
// 源码只有一份，在 plugins/flash-sh/（也能单独打成 fl-bash 包）；发布前把它同步进包根：
//   plugins/flash-sh/lib/index.js                     → lib/fl-bash.js（DEFAULT_BIN 按 ../vendor 找 exe，放在 lib/ 下正好指到包根 vendor/）
//   plugins/flash-sh/vendor/win32-x64/flash-sh.exe(.sha256) → vendor/win32-x64/
//   plugins/flash-sh/locale/*.json                    → locale/fl-bash/*.json（插件页标题 / 简介）
//   plugins/flash-sh/NOTICE、THIRD_PARTY_LICENSE*      → vendor/win32-x64/（exe 的第三方许可，随 exe 再分发必须带）
// 都是逐字节复制（git 里相同内容只存一份 blob，不额外占仓库体积）。
//   node scripts/sync-fl-bash.mjs           同步
//   node scripts/sync-fl-bash.mjs --check   只校验是否一致（CI / verify 用）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'plugins', 'flash-sh');
export const PAIRS = [
  ['lib/index.js', 'lib/fl-bash.js'],
  ['vendor/win32-x64/flash-sh.exe', 'vendor/win32-x64/flash-sh.exe'],
  ['vendor/win32-x64/flash-sh.exe.sha256', 'vendor/win32-x64/flash-sh.exe.sha256'],
  ['locale/zh.json', 'locale/fl-bash/zh.json'],
  ['locale/en.json', 'locale/fl-bash/en.json'],
  // exe 静态链接了第三方 crate（MIT / Apache-2.0 / Unicode-3.0 等）：随 exe 再分发时必须带上许可清单与全文
  ['NOTICE', 'vendor/win32-x64/NOTICE'],
  ['THIRD_PARTY_LICENSES.md', 'vendor/win32-x64/THIRD_PARTY_LICENSES.md'],
  ['THIRD_PARTY_LICENSE_TEXTS.txt', 'vendor/win32-x64/THIRD_PARTY_LICENSE_TEXTS.txt'],
];
const checkOnly = process.argv.includes('--check');
let bad = 0;
for (const [from, to] of PAIRS) {
  const a = path.join(src, from);
  const b = path.join(root, to);
  if (!fs.existsSync(a)) { console.error('✖ 缺源文件 plugins/flash-sh/' + from); bad++; continue; }
  const buf = fs.readFileSync(a);
  const same = fs.existsSync(b) && Buffer.compare(buf, fs.readFileSync(b)) === 0;
  if (same) { if (checkOnly) console.log('✓ ' + to + ' 与 plugins/flash-sh/' + from + ' 一致'); continue; }
  if (checkOnly) { console.error('✖ ' + to + ' 与 plugins/flash-sh/' + from + ' 不一致 —— 请运行: node scripts/sync-fl-bash.mjs'); bad++; continue; }
  fs.mkdirSync(path.dirname(b), { recursive: true });
  fs.writeFileSync(b, buf);
  console.log('✓ 已同步 ' + to + '（' + buf.length + ' 字节）');
}
if (bad) process.exit(1);
if (checkOnly) console.log('✓ fl-bash 随包副本与 plugins/flash-sh 一致');
