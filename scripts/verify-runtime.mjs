#!/usr/bin/env node
/**
 * 运行时合成断言：直接检查 `dsh --dump-config` 的产物，证明预设装进去之后"真的生效"，
 * 而不只是进了补丁文件。
 *
 *   node scripts/verify-runtime.mjs                 # 自己跑 dump-config（需要 PATH 里有 dsh）
 *   node scripts/verify-runtime.mjs dump.txt        # 校验已导出的 dump
 *   DSH_PROFILE=ci node scripts/verify-runtime.mjs
 *
 * 没有 dsh 时退出码 2（跳过）—— 调用方应把它当「跳过」而不是「通过」。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const EXPECT = {
  'flash-lean-ptc-v1': { order: 21, rules: 14, thr: '0.3', retain: '50000' },
  'flash-lean-ptc-v2': { order: 22, rules: 12, thr: '0.25', retain: '20000' },
  'flash-lean-ptc-v3': { order: 27, rules: 13, thr: '0.25', retain: '20000' },
};
// 0.2.5 起 bundle 默认只装 v3；v1/v2 是对照版本，装了才校验（--all-presets / -AllPresets）
const SHIPPED = new Set(['flash-lean-ptc-v3']);

const arg = process.argv[2];
let dump = '';
if (arg) {
  dump = fs.readFileSync(arg, 'utf8');
} else {
  const profile = process.env.DSH_PROFILE || 'web';
  try {
    dump = execFileSync('dsh', ['--profile', profile, '--dump-config'], {
      encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    console.log('skip: 没有可用的 dsh CLI（' + (error.code || error.message) + '）');
    console.log('退出码 2 = 跳过，不等于通过。');
    process.exit(2);
  }
}

let failed = 0;
const check = (cond, msg) => {
  console.log((cond ? '  ✓ ' : '  ✖ ') + msg);
  if (!cond) failed++;
};

const sliceOf = (name) => {
  const a = dump.indexOf('- id: preset-' + name);
  if (a < 0) return '';
  const b = dump.indexOf('- id: preset-', a + 1);
  return dump.slice(a, b < 0 ? dump.length : b);
};

console.log('dump 来源: ' + (arg || 'dsh --dump-config') + '（' + dump.length + ' 字节）');
for (const [name, exp] of Object.entries(EXPECT)) {
  const slice = sliceOf(name);
  console.log('\n[' + name + ']');
  check(slice !== '' || !SHIPPED.has(name), SHIPPED.has(name) ? '进入合成结果' : '未安装（对照版本，默认不装）');
  if (!slice) continue;
  check(new RegExp('^\\s*order: ' + exp.order + '$', 'm').test(slice), 'order = ' + exp.order);
  check(slice.includes('thresholdRatio: ' + exp.thr), '压缩阈值 ' + exp.thr);
  check(slice.includes('retainTokens: ' + exp.retain), '保留预算 ' + exp.retain);
  const rules = [...slice.matchAll(/^\s+(\d{1,2})\. /gm)].map((m) => Number(m[1]))
    .filter((n, i, all) => all.indexOf(n) === i);
  check(rules.length === exp.rules, '规则条数 ' + rules.length + '（期望 ' + exp.rules + '）');
  check(/mode: ptc/.test(slice), 'PTC 展示层');
}
const installed = (dump.match(/id: preset-flash-lean-ptc-v/g) || []).length;
check(installed >= 1 && installed <= 3, '预设行数 ' + installed + '（默认 1；--all-presets 时最多 3）');

console.log('');
if (failed === 0) { console.log('运行时合成断言通过'); process.exit(0); }
console.error('运行时合成断言失败：' + failed + ' 项');
process.exit(1);
