#!/usr/bin/env node
// 生成 p-sort-files 的 data/ 三组数据（各 ~10000 行整数，有重复、无序）。
// 一次性使用：node bench/scripts/gen-seed-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..', 'problems', 'seed', 'p-sort-files', 'data');
fs.mkdirSync(dir, { recursive: true });

// 固定种子的伪随机（可复现，不依赖外部库）
let seed = 20261101;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

for (const [name, base] of [['numbers-1.txt', 0], ['numbers-2.txt', 40000], ['numbers-3.txt', 80000]]) {
  const lines = [];
  for (let i = 0; i < 10000; i++) lines.push(String(base + Math.floor(rand() * 50000)));
  fs.writeFileSync(path.join(dir, name), lines.join('\n') + '\n');
  console.log(`✓ ${name}（${lines.length} 行）`);
}

// p-rounding 的 input.json：1000 个 1e6 附近的实数（含小数），固定种子可复现。
const roundDir = path.join(here, '..', 'problems', 'seed', 'p-rounding');
const values = [];
for (let i = 0; i < 1000; i++) {
  values.push(Number((1000000 + rand() * 200000 - 100000 + rand() * 0.987654).toFixed(6)));
}
fs.writeFileSync(path.join(roundDir, 'input.json'), JSON.stringify({ n: values.length, values }, null, 2) + '\n');
console.log(`✓ p-rounding/input.json（${values.length} 个值）`);
