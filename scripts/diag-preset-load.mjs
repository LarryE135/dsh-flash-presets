#!/usr/bin/env node
// diag-preset-load.mjs —— 定位 GUI 里「Agent 预设」卡片显示「加载失败」的原因
// 用法：node scripts/diag-preset-load.mjs [--profile desktop] [--dsh-home <path>]
// 它只读，不改任何文件。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

import { runDsh, resolveDsh, tryDshVersion } from './lib/run-dsh.mjs';
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const profile = opt('profile', 'web');
const dshHome = opt('dsh-home', path.join(os.homedir(), '.dsh'));
const profileDir = path.join(dshHome, 'profiles', profile);

const say = (s) => console.log(s);
const ok = (s) => console.log('  ✓ ' + s);
const bad = (s) => console.log('  ✖ ' + s);

say('profile : ' + profileDir);

// 1) 包内的预设文件
const pkgDir = path.join(profileDir, 'node_modules', 'dsh-flash-presets');
if (!fs.existsSync(pkgDir)) {
  bad('profile 里没有 dsh-flash-presets（未安装或装到别的 profile）');
  process.exit(1);
}
const version = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
ok('dsh-flash-presets ' + version);

// 2) 每个预设引用了哪些插件包
const presetDir = path.join(pkgDir, 'presets');
const presets = fs.existsSync(presetDir) ? fs.readdirSync(presetDir).filter((f) => f.endsWith('.yml')) : [];
const names = new Set();
for (const f of presets) {
  const text = fs.readFileSync(path.join(presetDir, f), 'utf8');
  for (const m of text.matchAll(/name:\s*'(@deepseek-ai\/[^']+)'/g)) names.add(m[1]);
  for (const m of text.matchAll(/name:\s*"(@deepseek-ai\/[^"]+)"/g)) names.add(m[1]);
}
say('预设引用插件数 : ' + names.size + '（来自 ' + presets.length + ' 个预设文件）');

// 3) 这些包在 profile / 应用自带依赖里能不能找到
const pnpmDir = path.join(profileDir, 'node_modules', '.pnpm');
const have = new Set();
const addName = (n) => have.add(n);
if (fs.existsSync(path.join(profileDir, 'node_modules'))) {
  for (const scope of fs.readdirSync(path.join(profileDir, 'node_modules'))) {
    if (!scope.startsWith('@')) continue;
    for (const sub of fs.readdirSync(path.join(profileDir, 'node_modules', scope))) addName(scope + '/' + sub);
  }
}
if (fs.existsSync(pnpmDir)) {
  for (const d of fs.readdirSync(pnpmDir)) {
    const m = d.match(/^(@[^+]+)\+(.+?)@/);
    if (m) addName(m[1] + '/' + m[2]);
    else {
      const m2 = d.match(/^(.+?)@[^@]+$/);
      if (m2 && d.includes('@deepseek-ai')) addName(m2[1]);
    }
  }
}
const bundles = (() => {
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
    return pj['dsh'] && pj['dsh']['profile'] ? pj['dsh']['profile']['bundles'] || [] : [];
  } catch { return []; }
})();
say('bundles : ' + (bundles.length ? bundles.join(', ') : '(无)'));

// DSH 自身安装目录里的插件包也算“能找到”
try {
  // 以前这里用 `node -e` + `command -v dsh`：command -v 是 POSIX 内建，Windows 的 cmd 下必然失败。
  // 现在直接复用 run-dsh 的解析结果（Windows 上会给出 dsh.cmd 的绝对路径）。
  const dshBin = dshBinDir();
  if (!dshBin) throw new Error('dsh 路径未知');
  const root = path.resolve(dshBin, '..');
  for (const base of [path.join(root, 'node_modules'), path.join(root, '..', 'node_modules')]) {
    if (!fs.existsSync(base)) continue;
    for (const scope of fs.readdirSync(base)) {
      if (!scope.startsWith('@')) continue;
      for (const sub of fs.readdirSync(path.join(base, scope))) addName(scope + '/' + sub);
    }
  }
} catch {}

// dsh 所在目录（找不到就返回空串，调用方按“未知”处理）。
function dshBinDir() {
  const file = resolveDsh().file;
  return file === 'dsh' ? '' : path.dirname(file);
}
const baseName = (n) => n.split('/').slice(0, 2).join('/'); // 去掉 /tools 之类的子路径
const inAsar = /app\.asar/.test(fs.realpathSync(pkgDir));
const haveBase = new Set([...have].map(baseName));
const missing = [...names].filter((n) => !haveBase.has(baseName(n)));
if (missing.length === 0) {
  ok('预设引用的插件包全部能解析到（profile 或 DSH 安装目录）');
} else if (inAsar) {
  say('  · 有 ' + missing.length + ' 个包在本机找不到，但本 profile 装在 app.asar 内，可能只是打包所致，不能据此判定');
} else {
  bad('有 ' + missing.length + ' 个插件包在 profile 里找不到（这就是「加载失败」的直接原因之一）：');
  for (const n of missing.sort()) say('      - ' + n);
  say('    处理：这些包在新版 DSH 里可能改名或内置到 app.asar；把本文件第 3 节的清单发出来即可定位。');
}

// 4) 客户端注册 id 是否等于包名（旧版「Failed to load plugins」的经典原因）
const client = path.join(pkgDir, 'lib', 'client.js');
if (fs.existsSync(client)) {
  const t = fs.readFileSync(client, 'utf8');
  const m = t.match(/__ModuleLoader__\.load\(\{\s*id:\s*['"]([^'"]+)['"]/);
  if (m && m[1] === 'dsh-flash-presets') ok('客户端注册 id = 包名（' + m[1] + '）');
  else bad('客户端注册 id 不等于包名：' + (m ? m[1] : '(未找到 load 调用)'));
} else {
  say('  · 包内没有 lib/client.js（只有计划模式才需要，属于正常）');
}

// 5) 组合配置能否解析
try {
  const out = runDsh( ['--profile', profile, '--dump-config'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const rows = (out.match(/id: preset-flash-lean-ptc-v[\w-]+/g) || []);
  ok('--dump-config 解析成功，预设行 ' + rows.length + ' 条：' + [...new Set(rows)].join(', '));
  const warns = out.split(/\r?\n/).filter((l) => /not found|mismatch|unknown/i.test(l));
  if (warns.length) { bad('组合期有 ' + warns.length + ' 条告警：'); warns.slice(0, 10).forEach((w) => say('      ' + w.trim())); }
} catch (e) {
  say('  · dsh --dump-config 不可用（桌面版 profile 由 Electron 独占管理时会这样，属正常）：' + String(e.message || e).split('\n')[0]);
}

