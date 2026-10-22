#!/usr/bin/env node
/**
 * 把 presets/*.patch.yml 与宿主自检行合成为组合包补丁层 cordis.patch.yml —— 零依赖、跨平台。
 *
 *   node scripts/compose-bundle-patch.mjs            # 生成/刷新 cordis.patch.yml
 *   node scripts/compose-bundle-patch.mjs --check     # 只校验"提交的文件 == 合成结果"（CI 用）
 *
 * 为什么要合成成一个文件：
 *   DSH 支持 `dsh.bundle.patch` 写成字符串或数组，但生态里的第三方工具
 *   （如 dsh-plugin-doctor）按字符串处理；单文件 cordis.patch.yml 是社区惯例，
 *   兼容性最好。本文件是唯一入口，presets/* 是源文件。
 *
 * 合成结果 = 1 个宿主自检行（flash-presets-selfcheck，见 lib/selfcheck.mjs）
 *          + 3 个预设 insert 块（v1 / v2 / v3）。
 * 注意：自检行只存在于 bundle 形态；scripts/install.sh|ps1 的手动托管块渠道
 * 只写 3 个预设行（那是旧版 DSH 的安装路径，没有 bundle 包目录可解析自检模块）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const SOURCES = ['presets/flash-lean-ptc-v1.patch.yml', 'presets/flash-lean-ptc-v2.patch.yml', 'presets/flash-lean-ptc-v3.patch.yml'];
const TARGET = 'cordis.patch.yml';
const HEADER = [
  '# dsh-flash-presets —— 组合包补丁层（bundle patch）',
  '# 本文件按顺序叠加：宿主自检行 + 三个预设（v1 基线、v2 上一代、v3 现行主版本 lean-v3）。',
  '# 由 presets/flash-lean-ptc-v{1,2,3}.patch.yml 与 lib/selfcheck.mjs 的声明合成；',
  '# 改预设请改源文件后重新合成：',
  '#   node scripts/compose-bundle-patch.mjs',
  '# CI 会断言本文件与合成结果一致，请勿手工编辑。',
  '',
].join('\n');

const SELFCHECK = [
  '# 宿主层自检行（lib/selfcheck.mjs）：只写日志、永不阻断启动，可用',
  '# `- id: flash-presets-selfcheck` + `disabled: true` 在 profile 补丁层关闭。',
  '- insert:',
  '    - id: flash-presets-selfcheck',
  "      name: './lib/selfcheck.mjs'",
  '      config:',
  '        presets: [flash-lean-ptc-v1, flash-lean-ptc-v2, flash-lean-ptc-v3]',
  '        dshRange: ">=0.1.7-rc.1 <0.3.0"',
  '',
].join('\n');

function compose() {
  const parts = SOURCES.map(rel => {
    const abs = path.join(repo, rel);
    if (!fs.existsSync(abs)) throw new Error('缺少源预设文件: ' + rel);
    return fs.readFileSync(abs, 'utf8').replace(/\s+$/, '');
  });
  const out = HEADER + SELFCHECK + parts.join('\n\n') + '\n';
  const inserts = (out.match(/^-\s*insert:/gm) ?? []).length;
  if (inserts !== SOURCES.length + 1) throw new Error('合成结果里的 insert 条目数异常: ' + inserts);
  for (const id of ['flash-presets-selfcheck', 'flash-lean-ptc-v1', 'flash-lean-ptc-v2', 'flash-lean-ptc-v3']) {
    if (!out.includes(id)) throw new Error('合成结果里缺少条目 id: ' + id);
  }
  return out;
}

const expected = compose();
const abs = path.join(repo, TARGET);
const actual = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;

if (process.argv.includes('--check')) {
  if (actual === expected) {
    console.log('✓ ' + TARGET + ' 与 presets/* + 自检行合成结果一致（' + expected.length + ' 字符 / ' + Buffer.byteLength(expected) + ' 字节）');
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
