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
// 发行包只装两个预设：精简·PTC v3（lean-v3，id flash-lean-ptc-v3，13 条，默认）
// 与 精简·PTC v3 balance（id flash-lean-ptc-v3-balance，3 条）。
// id 一旦发布就不再变动：DSH 把 preset id 写进会话日志，改名等于让旧会话报
// agent-preset/not-found。0.2.7–0.2.8 把 lite 的 id 改成 -lite 是错的，0.2.9 起改回。
// 0.2.5 的 v1/v2 与自建的 v3b/v3e **不随包发行**：谁需要就在自己的 profile 补丁里加行。
const SOURCES = [
  'presets/flash-lean-ptc-v3.patch.yml',
  'presets/flash-lean-ptc-v3-balance.patch.yml',
];
const TARGET = 'cordis.patch.yml';
const HEADER = [
  '# dsh-flash-presets —— 组合包补丁层（bundle patch）',
  '# 本文件叠加两个预设行（发行包的全部内容）：',
  '#   精简·PTC v3（lean-v3，flash-lean-ptc-v3，13 条，默认）、精简·PTC v3 balance（flash-lean-ptc-v3-balance，3 条）。',
  '#   id 固定为 flash-lean-ptc-v3 / flash-lean-ptc-v3-balance，不再随版本改名；',
  '#   历史 id（v3-lite / v1 / v2 / flash-lean-ptc / flash-lean，共 5 个）由 lib/preset-alias.js 运行时映射到 flash-lean-ptc-v3；',
  '#   v1 / v2 / v3b / v3e 不随包发行，需要的人在自己的 profile 补丁里加行。',
  '#   node scripts/compose-bundle-patch.mjs          # 两个预设都进 bundle',
  '# CI 会断言本文件与合成结果一致，请勿手工编辑。',
  '',
].join('\n');

// 运行时调优：随组合包一起落到 profile（B = PTC 常驻运行时）。
// 不能写成插件代码里的热改——executionMode 在 ptc-runtime 构造函数里读，构造后改不动。
const RUNTIME = [
  '',
  '# 运行时调优（随组合包生效；实测数据见仓库内 docs/压测-run_code开销.md，不随包发行）：PTC 运行时改为会话内常驻进程，',
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

// 历史 preset id 的解析兜底**单独成行**：只 inject agentPresets，任何宿主（web / 桌面端 / tui）都能加载。
// 挂在 plan-mode-ui 上的话，桌面端会因为 inject 里有 webServer 而停在 pending，旧会话照样打不开
// （第五轮审计 T1-1）。实现见 lib/alias-plugin.js + lib/preset-alias.js。
const ALIAS_ROW = [
  '',
  '# 历史 preset id 解析兜底（旧会话能否打开靠这一行）：纯内存映射，不写任何会话文件。',
  '- insert:',
  '    - id: flash-presets-alias',
  "      name: 'dsh-flash-presets/alias'",
].join('\n');


// 交付门（delivery-gate）：工作区里有 verify.sh 时，回合收尾自动跑一次；不通过就把失败清单回灌
// （最多 maxRounds 次），而不是让模型「如实地」交付部分分。默认 enabled: false —— 它会在用户
// 会话里跑工作区的脚本，属于要用户显式打开的开关。实测见 docs/实测证据.md。
const GATE_ROW = [
  '',
  '# 交付门（delivery-gate）：工作区里有 verify.sh 时，回合收尾自动跑一次；不通过就把失败清单回灌。',
  '# 默认关闭（enabled: false）—— 它会执行工作区里的脚本，要用户显式打开。',
  '- insert:',
  '    - id: delivery-gate',
  "      name: 'dsh-flash-presets/delivery-gate'",
  '      config:',
  '        enabled: false',
  '        scripts:',
  '          - verify.sh',
  '        maxRounds: 2',
].join('\n');
function compose() {
  const parts = SOURCES.map(rel => {
    const abs = path.join(repo, rel);
    if (!fs.existsSync(abs)) throw new Error('缺少源预设文件: ' + rel);
    return fs.readFileSync(abs, 'utf8').replace(/\s+$/, '');
  });
  const out = HEADER + parts.join('\n\n') + '\n' + RUNTIME + PLUGIN_ROW + ALIAS_ROW + GATE_ROW + '\n';
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
