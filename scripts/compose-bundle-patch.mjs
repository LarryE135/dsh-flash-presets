#!/usr/bin/env node
/**
 * 把 presets/*.patch.yml 合成为组合包补丁层 cordis.patch.yml —— 零依赖、跨平台。
 *
 *   node scripts/compose-bundle-patch.mjs            # 生成/刷新 cordis.patch.yml
 *   node scripts/compose-bundle-patch.mjs --check     # 只校验"提交的文件 == 合成结果"（CI 用）
 *
 * 为什么要合成成一个文件：
 *   DSH 支持 `dsh.bundle.patch` 写成字符串或数组，但生态里的第三方工具
 *   （如 dsh-plugin-doctor）按字符串处理；单文件 cordis.patch.yml 是社区惯例，
 *   兼容性最好。本文件是唯一入口，presets/* 是源文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
// 0.2.5 起默认只发布 v3（lean-v3，现行主版本）：装一次只多一个预设，不用在列表里挑。
// 需要对照 v1/v2（做 A/B 时）用 --all 显式合成三份。
const ALL_SOURCES = ['presets/flash-lean-ptc-v1.patch.yml', 'presets/flash-lean-ptc-v2.patch.yml', 'presets/flash-lean-ptc-v3.patch.yml'];
const SOURCES = process.argv.includes('--all') ? ALL_SOURCES : ['presets/flash-lean-ptc-v3.patch.yml'];
const TARGET = 'cordis.patch.yml';
const HEADER = [
  '# dsh-flash-presets —— 组合包补丁层（bundle patch）',
  '# 本文件默认只叠加 v3（lean-v3，现行主版本）：安装后预设列表里只多这一项。',
  '# v1/v2 是对照版本，源文件仍在 presets/，需要时用 --all 显式合成（做 A/B 才用得上）。',
  '#   node scripts/compose-bundle-patch.mjs          # v3（默认）',
  '#   node scripts/compose-bundle-patch.mjs --all    # v1 + v2 + v3',
  '# CI 会断言本文件与合成结果一致，请勿手工编辑。',
  '',
].join('\n');

function compose() {
  const parts = SOURCES.map(rel => {
    const abs = path.join(repo, rel);
    if (!fs.existsSync(abs)) throw new Error('缺少源预设文件: ' + rel);
    return fs.readFileSync(abs, 'utf8').replace(/\s+$/, '');
  });
  const out = HEADER + parts.join('\n\n') + '\n';
  const inserts = (out.match(/^-\s*insert:/gm) ?? []).length;
  if (inserts < SOURCES.length) throw new Error('合成结果里的 insert 条目数异常: ' + inserts);
  for (const rel of SOURCES) {
    const id = rel.replace(/^presets\//, '').replace(/\.patch\.yml$/, '');
    if (!out.includes(id)) throw new Error('合成结果里缺少预设 id: ' + id);
  }
  return out;
}

const expected = compose();
const abs = path.join(repo, TARGET);
const actual = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;

if (process.argv.includes('--check')) {
  if (actual === expected) {
    console.log('✓ ' + TARGET + ' 与 presets/* 合成结果一致（' + expected.length + ' 字符 / ' + Buffer.byteLength(expected) + ' 字节）');
    process.exit(0);
  }
  console.error('✗ ' + TARGET + ' 与 presets/* 合成结果不一致 —— 请运行: node scripts/compose-bundle-patch.mjs');
  process.exit(1);
}

if (actual === expected) {
  console.log('= ' + TARGET + ' 已是最新（' + expected.length + ' 字符 / ' + Buffer.byteLength(expected) + ' 字节）');
} else {
  fs.writeFileSync(abs, expected);
  console.log('✓ 已写入 ' + TARGET + '（' + expected.length + ' 字符 / ' + Buffer.byteLength(expected) + ' 字节）');
}
