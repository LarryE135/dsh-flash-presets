#!/usr/bin/env node
// 发行包 × 别名表 的一致性探针（第六轮审计 U2-3 / U2-4 的可自动化部分）。
//
// 它回答一个问题：**装好的组合配置里，别名表指向的那个 id 真的存在吗？**
// 0.2.8 → 0.2.9 那次事故就是这个问题答错了（会话里的 id 解析到一个包里没有的定义）。
//
// 用它喂三种输入都行：
//   node tools/probe/alias-vs-config.mjs <dump.txt>        # dsh --profile x --dump-config 的输出（CI 里就这么跑）
//   node tools/probe/alias-vs-config.mjs --composed        # 直接读仓库里的 cordis.patch.yml
//   node tools/probe/alias-vs-config.mjs                    # 等价于 --composed
//
// 不覆盖什么：真实的「建会话 → 升级 → resume」。那一步需要能跑模型的 provider，
// CI 里没有凭据，只能人工（见 docs/审计索引-0.2.9.md 第 7 节）。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAliasMap } from '../../lib/preset-alias.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = process.argv[2];
const text = !arg || arg === '--composed'
  ? readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
  : readFileSync(arg, 'utf8');

const map = loadAliasMap();
if (!map) {
  console.error('✖ 读不到 legacy-preset-map.json —— 别名表不存在，历史 id 无法解析');
  process.exit(1);
}

// 组合配置里「真的会被挂上」的 preset id：dump 里是 `id: preset-flash-lean-ptc-v3`，
// 源文件里是 `- id: flash-lean-ptc-v3`（在 @deepseek-ai/dsh-agent-preset 行内）。两种都认。
const present = new Set();
for (const line of text.split(/\r?\n/)) {
  const m = /^\s*-?\s*id:\s*['"]?preset-([A-Za-z0-9._-]+)['"]?\s*$/.exec(line)
    || /^\s*-?\s*id:\s*['"]?(flash-lean-ptc-v3(?:-balance)?)['"]?\s*$/.exec(line);
  if (m) present.add(m[1]);
}

const problems = [];
if (!present.has(map.canonical)) {
  problems.push('canonical 预设 ' + map.canonical + ' 不在配置里 —— 别名解析出来的 id 会指向空');
}
for (const [from, entry] of Object.entries(map.aliases)) {
  const to = entry && entry.to ? entry.to : map.canonical;
  if (!present.has(to)) {
    problems.push('别名 ' + from + ' → ' + to + '，但 ' + to + ' 不在配置里');
  }
}

// 别名层那一行本身也必须在（0.2.9 起它是独立插件行，桌面端靠它）。
if (!/flash-presets-alias/.test(text)) {
  problems.push('配置里没有 flash-presets-alias 行 —— 旧会话会以「预设不存在」失败');
}

if (problems.length) {
  console.error('✖ 别名与配置不一致（' + problems.length + ' 项）');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('✓ 别名表与配置一致（canonical ' + map.canonical + '，' + Object.keys(map.aliases).length + ' 个历史 id，别名行在）');
