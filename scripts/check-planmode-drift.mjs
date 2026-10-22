#!/usr/bin/env node
/**
 * plan-mode section 漂移检查 —— 零依赖、跨平台。
 *
 * 背景：预设把 DSH 内置 plan-mode 的 `section` 全文冻结进自己的 YAML。DSH 演进时
 * 上游措辞会变（0.2.1 已把「until exit_plan_mode succeeds」改为「until the user
 * approves your plan through exit_plan_mode」），冻结的副本会静默过期。本脚本把
 * 预设里的 section 与目标 DSH 版本 `--dump-config` 输出中的上游 section 逐词对比。
 *
 *   node scripts/check-planmode-drift.mjs --dump dump.txt --dsh 0.2.1-rc.2
 *   node scripts/check-planmode-drift.mjs --dump dump.txt --dsh 0.2.1-rc.2 --ack docs/plan-mode-drift.json
 *
 * 判定：
 *   - ours（presets/*.patch.yml 的三份 section，规范化后）与上游任一 section 全等 → OK。
 *   - 不一致 → DRIFT。若 docs/plan-mode-drift.json 记录了该 (dsh 版本, 预设) 的
 *     acknowledged 条目，则降级为警告（exit 0）；否则 exit 1 —— 逼维护者要么
 *     更新 section 跟上上游，要么留下书面豁免理由。
 *
 * 无 --dump 时只校验三个预设的 section 彼此一致，并提示需要 dump 才能做上游对比。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');

const argv = process.argv.slice(2);
const opt = (name, dflt = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const dumpPath = opt('--dump');
const dshVersion = opt('--dsh');
const ackPath = path.join(repo, opt('--ack', path.join('docs', 'plan-mode-drift.json')));

/** 规范化：压缩空白后比较措辞（dump 的 `>` 折叠标量与仓库的 `|` literal 在空白上不等价）。 */
const normalize = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** 行扫描提取 dump 中所有 `section:` 块（`>`/`|` 标量，可能跨行），并跟踪所属预设。 */
function sectionsFromDump(text) {
  const lines = String(text).split(/\r?\n/);
  const found = [];
  let context = null;
  for (let i = 0; i < lines.length; i++) {
    const preset = /^- id: preset-(\S+)/.exec(lines[i]);
    if (preset) context = preset[1];
    const m = /^(\s*)section:\s*([>|])[-+]?\s*$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const fold = m[2] === '>';
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() === '') { body.push(''); continue; }
      const lm = /^(\s*)\S/.exec(line);
      if (!lm || lm[1].length <= indent) break;
      body.push(line.slice(Math.min(indent, lm[1].length)));
    }
    let text;
    if (fold) text = body.map((l) => l.trim()).filter((l, idx, arr) => l !== '' || (arr[idx + 1] !== undefined && arr[idx + 1] !== '')).join(' ');
    else text = body.join('\n').replace(/\s+$/, '');
    found.push({ context, text: normalize(text) });
    i += body.length;
  }
  return found;
}

/** 提取仓库三个预设文件的 section（`|` literal 块）。 */
function sectionsFromRepo() {
  const found = [];
  for (const name of ['flash-lean-ptc-v1.patch.yml', 'flash-lean-ptc-v2.patch.yml', 'flash-lean-ptc-v3.patch.yml']) {
    const file = path.join(repo, 'presets', name);
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\s*)section:\s*[|][-+]?\s*$/.exec(lines[i]);
      if (!m) continue;
      const indent = m[1].length;
      const body = [];
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (line.trim() === '') { body.push(''); continue; }
        const lm = /^(\s*)\S/.exec(line);
        if (!lm || lm[1].length <= indent) break;
        body.push(line.slice(Math.min(indent, lm[1].length)));
      }
      found.push({ file: name, text: normalize(body.join('\n')) });
      i += body.length;
    }
  }
  return found;
}

/** 报告两份规范化文本的首处差异。 */
function firstDiff(a, b) {
  const wa = a.split(' ');
  const wb = b.split(' ');
  for (let i = 0; i < Math.max(wa.length, wb.length); i++) {
    if (wa[i] !== wb[i]) {
      return `第 ${i + 1} 词起不同：\n    上游: …${wa.slice(Math.max(0, i - 3), i + 8).join(' ')}…\n    本包: …${wb.slice(Math.max(0, i - 3), i + 8).join(' ')}…`;
    }
  }
  return '（长度不同但前缀一致）';
}

function loadAck() {
  try {
    const raw = JSON.parse(fs.readFileSync(ackPath, 'utf8'));
    return Array.isArray(raw.acknowledged) ? raw.acknowledged : [];
  } catch {
    return [];
  }
}

let failed = 0;
const check = (cond, msg) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  if (!cond) failed++;
};

const ours = sectionsFromRepo();
console.log(`本包 section：${ours.length} 份（${new Set(ours.map((o) => o.text)).size} 份互异）`);

// 0) 三份预设的 section 必须彼此一致（同一段政策）。
const distinctOurs = [...new Set(ours.map((o) => o.text))];
check(ours.length === 3 && distinctOurs.length === 1 && distinctOurs[0] && distinctOurs[0].length > 200,
      '三个预设的 plan-mode section 彼此一致（且非空）');
if (distinctOurs.length > 1) {
  for (let i = 1; i < distinctOurs.length; i++) console.log(firstDiff(distinctOurs[0], distinctOurs[i]));
}

if (!dumpPath) {
  console.log('\n未提供 --dump：跳过上游对比（CI 的 bundle-install job 会带上）。');
  console.log(failed ? '漂移检查失败。' : '漂移检查通过（仅仓库内部一致性）。');
  process.exit(failed ? 1 : 0);
}

/** 读取文本文件，容忍 Windows PowerShell 5.1 重定向产生的 UTF-16 LE/BE BOM。 */
function readText(file) {
  const buf = fs.readFileSync(file);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  return buf.toString('utf8');
}

const dumpText = readText(dumpPath);
const all = sectionsFromDump(dumpText);
// 上游基准 = shipped 预设（standard/ptc/minimal/cordis）里的 plan-mode section。
// dump 里 context 为 null 的是 base 层的宿主行（正常 profile 里 disabled，不在会话生效），
// 不作基准；没有 shipped 预设说明 dump 用的 profile 缺 web-app（如自建裸 profile）——
// 请改用 web profile 的 dump。
const upstream = [...new Set(all.filter((s) => s.context && !/^flash-lean-/.test(s.context)).map((s) => s.text))];
console.log(`\n上游 section（DSH ${dshVersion || '未知版本'} dump）：${all.length} 份、${upstream.length} 份互异（来自 shipped 预设）；`)
if (upstream.length === 0) {
  console.log('dump 里没有 shipped 预设的 plan-mode section（profile 是否缺 web-app bundle？）——请用 web profile 重新 dump。');
  process.exit(1);
}

const acks = loadAck();
const presetIds = ['flash-lean-ptc-v1', 'flash-lean-ptc-v2', 'flash-lean-ptc-v3'];
for (const [index, item] of ours.entries()) {
  const presetId = presetIds[index] || 'unknown';
  const match = upstream.includes(item.text);
  if (match) {
    check(true, `${presetId} 的 section 与上游一致`);
    continue;
  }
  const acked = acks.some((a) => a && a.dsh === dshVersion && a.preset === presetId);
  console.log(`  ✖ ${presetId} 与上游漂移（DSH ${dshVersion || '未知'}）`);
  const best = upstream.sort((a, b) => a.length - b.length).map((u) => u)[0];
  if (best) console.log('    ' + firstDiff(best, item.text).replace(/\n/g, '\n    '));
  if (acked) {
    console.log(`    ⚠ 已在 ${path.relative(repo, ackPath)} 记录豁免，按警告处理。`);
  } else {
    console.log(`    修复：把 ${item.file} 的 section 更新为上游原文，或在 ${path.relative(repo, ackPath)} 里补 acknowledged 条目。`);
    failed++;
  }
}

console.log('\n' + (failed ? '漂移检查失败：' + failed + ' 项。' : '漂移检查通过。'));
process.exit(failed ? 1 : 0);
