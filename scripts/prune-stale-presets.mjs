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
import yaml from 'js-yaml';
import os from 'node:os';
import path from 'node:path';

// 0.2.9 起 v1/v2 是真实兼容卡（0.2.5 原规则），不再算退役 id —— 清掉它们会让旧会话失联。
const RETIRED = ['flash-lean-ptc-v3-1-high', 'flash-lean-ptc-v3-1-max'];
const A = process.argv.slice(2);
const APPLY = A.includes('--apply');
const pi = A.indexOf('--profile');
const ONLY = (() => {
  if (pi < 0) return null;
  const v = A[pi + 1];
  if (v === undefined || v === '' || String(v).startsWith('--')) {
    console.error('--profile 需要一个值，例如 --profile web；只写 --profile 会清理全部 profile，已中止。');
    process.exit(2);
  }
  return v;
})();
// 与 tune-runtime 一致：尊重 DSH_HOME（隔离环境/测试里绝不能去动真实的 ~/.dsh）
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const ROOT = path.join(DSH_HOME, 'profiles');

if (!fs.existsSync(ROOT)) {
  console.log('找不到 ' + ROOT);
  process.exit(2);
}

/** 从文本里摘掉一个「列表项」（最小删除）：只删属于该 id 的那一项，不动同一 insert 里的其它项。
 *  旧实现按「整块 insert」删，会连带把现役预设一起删掉；单 insert 场景还会把文件清成 0 字节。 */
function dropItem(text, id) {
  const lines = text.split("\n");
  const re = new RegExp("^[ \t]*-[ \t]*id:[ \t]*(?:preset-)?" + id + "[ \t]*$");
  let idx = -1;
  for (let k = 0; k < lines.length; k += 1) {
    if (re.test(lines[k])) { idx = k; break; }
  }
  if (idx < 0) return text;
  const indent = lines[idx].length - lines[idx].trimStart().length;
  let endLine = idx + 1;
  while (endLine < lines.length) {
    const ln = lines[endLine];
    if (ln.trim() === "") { endLine += 1; continue; }
    const ind = ln.length - ln.trimStart().length;
    if (ind < indent) break;                                 // 回到上层（例如 insert: 本身）
    if (ind === indent && /^[ \t]*-[ \t]/.test(ln)) break;   // 同级下一项
    endLine += 1;
  }
  lines.splice(idx, endLine - idx);
  return lines.join("\n");
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
  // 行内 id 有两种写法：`- id: preset-<id>` 与 `id: <id>`（config 里那份）。两种都算命中。
  const hits = RETIRED.filter((id) => new RegExp('^[ \\t]*-[ \\t]*id:[ \\t]*(?:preset-)?' + id + '[ \\t]*$', 'm').test(text));
  if (!hits.length) {
    console.log(path.basename(dir).padEnd(12) + '干净');
    continue;
  }
  total += hits.length;
  console.log(path.basename(dir).padEnd(12) + '残留: ' + hits.join(', '));
  if (!APPLY) continue;
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  fs.copyFileSync(file, file + '.bak-prune-' + stamp);
  for (const id of hits) text = dropItem(text, id);
  // 兜底：删完为空（或只剩注释/空行）时写回 []，别留下 0 字节或空文档。
  const stripped = text.replace(/#[^\n]*/g, "").trim();
  if (stripped === "" || stripped === "[]") text = "[]\n";
  // 结构校验：解析不了就回滚，绝不写坏 profile 补丁。
  try {
    yaml.load(text);
  } catch (error) {
    console.error(path.basename(dir).padEnd(12) + "✖ 清理后 YAML 解析失败，已回滚：" + String(error && error.message));
    continue;
  }
  fs.writeFileSync(file, text);
  console.log(path.basename(dir).padEnd(12) + '→ 已清理（备份 ' + path.basename(file) + '.bak-prune-' + stamp + '）');
}

if (!APPLY && total) {
  console.log('\n共 ' + total + ' 处残留；加 --apply 清理（会先备份）。');
  process.exit(1);
}
if (APPLY) console.log('\n完成。清理过 cordis.patch.yml 的 profile 需要重启 dsh。');
