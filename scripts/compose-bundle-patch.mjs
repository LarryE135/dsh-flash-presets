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
// 0.2.7 起只提供两个预设：轻量PTC-v3 lite（id flash-lean-ptc-v3，13 条，默认）
// 与 轻量PTC-v3 balance（id flash-lean-ptc-v3-balance，3 条）。id 沿用 0.2.5 的身份，旧会话不需要迁移。
const SOURCES = [
  'presets/flash-lean-ptc-v3-lite.patch.yml',
  'presets/flash-lean-ptc-v3-balance.patch.yml',
];
const TARGET = 'cordis.patch.yml';
const HEADER = [
  '# dsh-flash-presets —— 组合包补丁层（bundle patch）',
  '# 本文件叠加两个正式预设 + 一个兼容别名：',
  '#   轻量PTC-v3 lite（flash-lean-ptc-v3-lite，13 条，默认）、轻量PTC-v3 balance（flash-lean-ptc-v3-balance，3 条）、',
  '#   兼容别名（flash-lean-ptc-v3，13 条，内容同 lite，只为让升级前记录的会话按 id 打开）。',
  '#   node scripts/compose-bundle-patch.mjs          # 三者都进 bundle',
  '# CI 会断言本文件与合成结果一致，请勿手工编辑。',
  '',
].join('\n');

// 运行时调优：随组合包一起落到 profile（B = PTC 常驻运行时）。
// 不能写成插件代码里的热改——executionMode 在 ptc-runtime 构造函数里读，构造后改不动。
const RUNTIME = [
  '',
  '# 运行时调优（随组合包生效，见 docs/压测-run_code开销.md）：PTC 运行时改为会话内常驻进程，',
  '# 每个 run_code program 只付一次启动成本，嵌套工具调用 44ms → 15ms。',
  '# 配套 scripts/tune-runtime.mjs --apply 负责 A（fs-search 的 glob/grep 只读并发）。',
  '- id: ptc-runtime',
  '  config:',
  '    executionMode: persistent-in-memory',
].join('\n');

// 计划模式（plan-mode v1）是本包的第三个组件：宿主半边由包根的 main（lib/index.js）提供，
// 浏览器半边由 dsh.client 声明。这一行把组件挂到 profile，插件列表里显示在 dsh-flash-presets 卡下。
// 注意 name 必须是本包名：解析器按 name 去找模块入口。
const PLUGIN_ROW = [
  '',
  '# 计划模式组件（plan-mode v1）：宿主半边与浏览器半边都来自本包。',
  '- insert:',
  '    - id: plan-mode-ui',
  "      name: 'dsh-flash-presets'",
].join('\n');

function compose() {
  const parts = SOURCES.map(rel => {
    const abs = path.join(repo, rel);
    if (!fs.existsSync(abs)) throw new Error('缺少源预设文件: ' + rel);
    return fs.readFileSync(abs, 'utf8').replace(/\s+$/, '');
  });
  const out = HEADER + parts.join('\n\n') + '\n' + RUNTIME + PLUGIN_ROW + '\n';
  const inserts = (out.match(/^-\s*insert:/gm) ?? []).length;
  if (inserts < SOURCES.length) throw new Error('合成结果里的 insert 条目数异常: ' + inserts);
  for (const rel of SOURCES) {
    // 按文件里的 config id 断言，而不是文件名（别名的文件名与 config id 不同）
    const text = fs.readFileSync(path.join(repo, rel), 'utf8');
    const id = (text.match(/\n\s+id: (\S+)\n/) || [])[1];
    if (!id) throw new Error('源文件里找不到 config id: ' + rel);
    if (!out.includes('id: ' + id)) throw new Error('合成结果里缺少预设 id: ' + id);
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
