#!/usr/bin/env node
/**
 * 清理升级残留的预设行。
 *
 * 为什么需要：`dsh plugin add` 把 bundle patch 叠加进 profile，但不会移除上一版插入的行。
 * 从 0.2.5 升到 0.2.6 后，profile 里会残留 `preset-flash-lean-ptc-v2`（旧包带过），
 * 选择器里就多出一个已经不随包发行的条目。
 *
 *   node scripts/prune-stale-presets.mjs                 # 只报告
 *   node scripts/prune-stale-presets.mjs --apply         # 真删（先备份）
 *   node scripts/prune-stale-presets.mjs --apply --profile web
 *
 * 只删“已知退役”的 id，不碰其他预设（standard / 用户自己装的都不动）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RETIRED = ['flash-lean-ptc-v1', 'flash-lean-ptc-v2', 'flash-lean-ptc-v3-1-high', 'flash-lean-ptc-v3-1-max'];
const A = process.argv.slice(2);
const APPLY = A.includes('--apply');
const pi = A.indexOf('--profile');
const ONLY = pi >= 0 ? A[pi + 1] : null;
const ROOT = path.join(os.homedir(), '.dsh', 'profiles');

if (!fs.existsSync(ROOT)) {
  console.log('找不到 ' + ROOT);
  process.exit(2);
}

/** 从文本里摘掉一个 insert 块（块首是 `- insert:`，块尾是下一条顶层 `- ` 之前）。 */
function dropBlock(text, marker) {
  const i = text.indexOf(marker);
  if (i < 0) return text;
  let start = text.lastIndexOf('\n- insert:', i);
  if (start < 0) start = text.lastIndexOf('- insert:', i);
  if (start < 0) return text;
  let end = text.indexOf('\n- ', i);
  if (end < 0) end = text.length;
  return text.slice(0, start) + text.slice(end);
}

const dirs = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => path.join(ROOT, d.name))
  .filter((d) => !ONLY || path.basename(d) === ONLY);

let total = 0;
for (const dir of dirs) {
  const file = path.join(dir, 'cordis.patch.yml');
  if (!fs.existsSync(file)) continue;
  let text = fs.readFileSync(file, 'utf8');
  const hits = RETIRED.filter((id) => text.includes('id: ' + id));
  if (!hits.length) {
    console.log(path.basename(dir).padEnd(12) + '干净');
    continue;
  }
  total += hits.length;
  console.log(path.basename(dir).padEnd(12) + '残留: ' + hits.join(', '));
  if (!APPLY) continue;
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  fs.copyFileSync(file, file + '.bak-prune-' + stamp);
  for (const id of hits) {
    text = dropBlock(text, '- id: preset-' + id);
    text = dropBlock(text, 'id: ' + id + '\n');
  }
  fs.writeFileSync(file, text);
  console.log(path.basename(dir).padEnd(12) + '→ 已清理（备份 ' + path.basename(file) + '.bak-prune-' + stamp + '）');
}

if (!APPLY && total) {
  console.log('\n共 ' + total + ' 处残留；加 --apply 清理（会先备份）。');
  process.exit(1);
}
if (APPLY) console.log('\n完成。清理过 cordis.patch.yml 的 profile 需要重启 dsh。');
