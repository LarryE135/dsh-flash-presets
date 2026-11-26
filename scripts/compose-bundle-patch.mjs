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

// 0.3.4 起本包的运行时功能只占**一行**（插件页上原来是 4 个组件：flash-presets-core / plan-mode-ui /
// flash-presets-alias / delivery-gate，标题全是裸模块名）。入口 lib/bundle.js 自己 inject 为空，
// 4 个功能作为子插件各按自己的 inject 启动、互不牵连 —— 桌面端缺 webServer 时只有计划模式宿主等待，
// 别名层 / 优化 A 照常（当初拆行要解决的 T1-1 仍然成立）。
// 用户按旧行 id 写的覆盖由 lib/row-overrides.js 在运行时读回并换算，不改写用户文件。
// 默认值必须与 lib/row-overrides.js 的 BUNDLE_DEFAULTS 一致（verify-core.mjs 断言）。
const BUNDLE_ROW = [
  '',
  '# 运行时功能（一行）：run_code 优化 A、计划模式宿主、历史 preset id 兼容、交付门，',
  '# 都挂在这一行下面，各自按需要的宿主服务启动，缺哪个服务只影响对应功能。0.3.2 及以前它们是 4 行',
  '# （flash-presets-core / plan-mode-ui / flash-presets-alias / delivery-gate），按旧 id 写的覆盖仍会被读回生效。',
  '# 环境变量优先于这里：DSH_FLASH_PRESETS_CONCURRENCY=0、DSH_FLASH_PRESETS_ALIAS=0、DSH_DELIVERY_GATE=0/1。',
  '# 交付门默认关闭（deliveryGate.enabled: false）—— 它会执行工作区里的验收脚本，要用户显式打开。',
  '- insert:',
  '    - id: flash-presets',
  "      name: 'dsh-flash-presets'",
  '      config:',
  '        toolConcurrency:',
  '          enabled: true',
  '        alias:',
  '          enabled: true',
  '        planMode:',
  '          enabled: true',
  '        deliveryGate:',
  '          enabled: false',
  '          maxRounds: 2',
].join('\n');

// Bash 工具 fl-bash：插件页上单独的一个组件（不挂在 flash-presets 行下），实现与 exe 随本包发行。
// 行的模块是本包子路径 dsh-flash-presets/fl-bash（lib/fl-bash-row.js）：任何平台都能加载，只在 Windows x64 上注册工具，
// 其他平台只写一行 info，不会变成红行。默认值必须与 lib/fl-bash-row.js 的 ROW_DEFAULTS 一致。
const FL_BASH_ROW = [
  '',
  '',
  '# Bash 工具（单独一个组件）：fl-bash —— Windows x64 上的 Bash 兼容 shell 工具 fl_bash，内置单文件解释器，',
  '# 不需要 Git Bash / WSL / MSYS2。默认关闭（enabled: false）—— 它在本机执行命令，要用户显式打开：',
  '#   在插件页打开它的设置，或在 profile 的 cordis.patch.yml 里写 `- id: fl-bash` + `config: { enabled: true }`，',
  '#   或设置用户环境变量 DSH_FL_BASH=1（旧名 DSH_FLASH_SH 仍认）。配置项见 fl-bash 的 README。',
  '# 实现与 flash-sh.exe（约 1.7 MB）随本包发行，从 npm 装好就能打开；只在 Windows x64 上注册工具。',
  '- insert:',
  '    - id: fl-bash',
  "      name: 'dsh-flash-presets/fl-bash'",
  '      config:',
  '        enabled: false',
  '',
].join('\n');
// 0.3.2 上下文瘦身（第二轮研究实测，见 docs/研究-DSH-0.2.2-rc.3-上下文注入.md）：
//   · tool-skill 默认把整段技能描述塞进目录；技能一多就是上千字符。压到 60 字符，语义保留。
//   · 两项 DeepSeek 专用上报不进上下文，但每请求会把整份会话日志（实测 34KB）与插件清单（6KB）
//     再传一遍。默认关掉；要用服务端分析时删掉这两条即可。
// 注意：这里是 patch（不是 insert），DSH 的 applyPatches 对非 insert 条目是「有则改、无则只警告」，
// 所以放到没有这些行的 profile 里也不会让启动失败。
const LEAN_ROWS = [
  '',
  '# 技能目录里每条描述的截断长度（默认整段；60 足够表达用途）。',
  '- id: tool-skill',
  '  config:',
  '    catalogDescriptionMaxLength: 60',
  '',
  '# 关掉两项 DeepSeek 专用请求体上报（不进上下文，只省上传）。',
  '- id: session-log-deepseek',
  '  disabled: true',
  '- id: plugin-package-inventory-deepseek',
  '  disabled: true',
].join('\n');

function compose() {
  const parts = SOURCES.map(rel => {
    const abs = path.join(repo, rel);
    if (!fs.existsSync(abs)) throw new Error('缺少源预设文件: ' + rel);
    return fs.readFileSync(abs, 'utf8').replace(/\s+$/, '');
  });
  const out = HEADER + parts.join('\n\n') + '\n' + RUNTIME + BUNDLE_ROW + FL_BASH_ROW + LEAN_ROWS + '\n';
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
