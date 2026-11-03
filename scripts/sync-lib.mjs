#!/usr/bin/env node
// 计划模式组件（plan-mode v1）的源码在 plugins/plan-mode-ui/，发布时同步到包根的 lib/。
// 包根 lib/ 是生成产物：改代码请改 plugins/plan-mode-ui/lib/，再跑本脚本。
//   node scripts/sync-lib.mjs           同步
//   node scripts/sync-lib.mjs --check   只校验是否一致（CI 用）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const srcDir = path.join(root, 'plugins', 'plan-mode-ui', 'lib');
const dstDir = path.join(root, 'lib');
const FILES = ['index.js', 'client.js', 'progress.js'];
const checkOnly = process.argv.includes('--check');

const missing = FILES.filter((f) => !fs.existsSync(path.join(srcDir, f)));
if (missing.length) {
  console.error('✖ plugins/plan-mode-ui/lib 缺文件：' + missing.join(', '));
  process.exit(1);
}

if (!checkOnly) fs.mkdirSync(dstDir, { recursive: true });
const drift = [];
for (const f of FILES) {
  const src = fs.readFileSync(path.join(srcDir, f));
  const dstPath = path.join(dstDir, f);
  if (checkOnly) {
    if (!fs.existsSync(dstPath)) { drift.push(f + '（缺失）'); continue; }
    if (!fs.readFileSync(dstPath).equals(src)) drift.push(f + '（内容不一致）');
    continue;
  }
  fs.writeFileSync(dstPath, src);
}

// 旧版遗留的 lib/index.mjs 会让解析器混淆，发现即删
const legacy = path.join(dstDir, 'index.mjs');
if (fs.existsSync(legacy)) {
  if (checkOnly) drift.push('lib/index.mjs（应删除）');
  else { fs.rmSync(legacy); console.log('  已删除 lib/index.mjs'); }
}

if (checkOnly) {
  if (drift.length) {
    console.error('✖ lib/ 与 plugins/plan-mode-ui/lib/ 不一致：' + drift.join('、'));
    console.error('  改法：node scripts/sync-lib.mjs');
    process.exit(1);
  }
  console.log('✓ lib/ 与 plugins/plan-mode-ui/lib/ 一致（' + FILES.length + ' 个文件）');
} else {
  console.log('✓ 已同步 ' + FILES.length + ' 个文件到 lib/');
}