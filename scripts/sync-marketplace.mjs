#!/usr/bin/env node
/**
 * marketplace/plugin.json 与 package.json 同步 —— 零依赖、跨平台。
 *
 *   node scripts/sync-marketplace.mjs            # 把 version / descriptionZh 等同步进 marketplace/plugin.json
 *   node scripts/sync-marketplace.mjs --check    # 只校验已同步（CI 用）
 *
 * 为什么需要：marketplace/plugin.json 曾停留在 0.2.1（包已是 0.2.2），市场清单与
 * 实际包版本脱节。版本、中文描述、仓库/安装指向由 package.json 派生，避免再次漂移。
 *
 * 不同步的字段：
 *   - description（英文）：package.json 的 description 是中文，英文文案保持手写。
 *   - verified：由插件市场的人工审核流程置位，本仓库不能自证。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const pkgPath = path.join(repo, 'package.json');
const marketPath = path.join(repo, 'marketplace', 'plugin.json');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const market = JSON.parse(fs.readFileSync(marketPath, 'utf8'));

const repoUrl = (pkg.repository && pkg.repository.url) || '';
const gitSpec = repoUrl.replace(/^git\+/, '');

const next = {
  ...market,
  version: pkg.version,
  descriptionZh: pkg.description,
  repository: gitSpec.replace(/\.git$/, ''),
  install: {
    ...(market.install || {}),
    spec: `github:${(gitSpec.match(/github\.com\/([^/]+\/[^/]+)/) || [])[1] || 'LarryE135/dsh-flash-presets'}`,
  },
};

const checkOnly = process.argv.includes('--check');
const actual = fs.readFileSync(marketPath, 'utf8');
const expected = JSON.stringify(next, null, 2) + '\n';

if (checkOnly) {
  if (actual === expected) {
    console.log(`✓ marketplace/plugin.json 与 package.json 同步（version ${pkg.version}）`);
    process.exit(0);
  }
  console.error('✗ marketplace/plugin.json 与 package.json 不同步 —— 请运行: node scripts/sync-marketplace.mjs');
  process.exit(1);
}

if (actual === expected) {
  console.log(`= marketplace/plugin.json 已同步（version ${pkg.version}）`);
} else {
  fs.writeFileSync(marketPath, expected);
  console.log(`✓ 已同步 marketplace/plugin.json（version ${pkg.version}）`);
}
