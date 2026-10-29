#!/usr/bin/env node
/**
 * 一条命令回答"装了预设之后 DSH 到底是哪儿不舒服"。
 *
 *   node scripts/doctor.mjs                    # 体检 web profile
 *   node scripts/doctor.mjs --profile headless
 *   node scripts/doctor.mjs --patch <文件路径>   # 直接体检某个补丁文件
 *   node scripts/doctor.mjs --fix               # 就地修：把 !!js 平台标签解成布尔（先备份）
 *   node scripts/doctor.mjs --dump              # 额外跑一次 dsh --dump-config，确认预设真的被认
 *
 * 检查项（逐条给结论，不做猜测）：
 *   1. DSH 版本是否支持"插件行预设"（0.1.7+）
 *   2. 托管块数量（0=没装；>1=重复安装）
 *   3. 托管块外的裸行（老安装方式残留，会导致预设列表重复）
 *   4. !!js 标签（非标准 YAML，普通解析器必报错；装到用户机器上应已解析掉）
 *   5. 补丁能否被标准 YAML 解析器读通，报错给到行号
 *   6. 可选：dump-config 里能不能找到三个预设 id
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolvePlatformTags, hasPlatformTags } from '../lib/platform-tags.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const flag = n => argv.includes(n);

const BEGIN = '# >>> dsh-flash-presets: managed block (0.1.7+ plugin-row presets) >>>';
const END = '# <<< dsh-flash-presets: managed block <<<';
const PRESETS = ['flash-lean-ptc-v1', 'flash-lean-ptc-v2', 'flash-lean-ptc-v3'];

const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const profile = opt('--profile', 'web');
const patchPath = path.resolve(opt('--patch', path.join(home, 'profiles', profile, 'cordis.patch.yml')));

const ok = m => console.log('  ✓ ' + m);
const warn = m => console.log('  ⚠ ' + m);
const bad = m => console.log('  ✗ ' + m);
const info = m => console.log('    ' + m);
const problems = [];

console.log('dsh-flash-presets doctor');
console.log('  平台 ' + process.platform + ' / node ' + process.versions.node);
console.log('  补丁 ' + patchPath);
console.log('');

// ── 1. DSH 版本 ──────────────────────────────────────────────────────────────
console.log('[1] DSH 版本');
let version = null;
try {
  version = execFileSync('dsh', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {
  bad('找不到 dsh 命令（PATH 里没有）—— 这一步跳过，其余检查仍有效');
  problems.push('dsh 不在 PATH');
}
if (version) {
  const m = version.match(/(\d+)\.(\d+)\.(\d+)/);
  const [maj, min] = m ? [Number(m[1]), Number(m[2])] : [0, 0];
  if (maj === 0 && min < 1) {
    bad(version + ' 太旧：插件行预设需要 0.1.7+');
    problems.push('DSH 版本过旧');
  } else {
    ok(version + '（支持插件行预设）');
  }
}

// ── 2/3. 托管块与残留 ────────────────────────────────────────────────────────
console.log('[2] 托管块');
if (!fs.existsSync(patchPath)) {
  bad('补丁文件不存在 —— 没装，或 profile 名字不对（当前 profile=' + profile + '）');
  problems.push('补丁文件缺失');
  console.log('');
  console.log('结论：先确认 profile 名，再运行 scripts/install.sh 或 install.ps1。');
  process.exit(1);
}
const raw = fs.readFileSync(patchPath, 'utf8');
const blocks = raw.split('\n').filter(l => l.trim() === BEGIN).length;
const ends = raw.split('\n').filter(l => l.trim() === END).length;
if (blocks === 0) {
  warn('没有托管块 —— 这些预设不是用本仓库的安装脚本装的（可能是手抄或 bundle patch）');
} else if (blocks > 1 || ends !== blocks) {
  bad('托管块数量异常：BEGIN=' + blocks + ' / END=' + ends + ' —— 重复安装或块被截断');
  problems.push('托管块重复/截断');
} else {
  ok('托管块完整（1 个）');
}

console.log('[3] 托管块外的残留行');
const insideBlock = (() => {
  const i = raw.indexOf(BEGIN);
  const j = raw.indexOf(END);
  return i >= 0 && j > i ? raw.slice(i, j + END.length) : '';
})();
const outside = raw.replace(insideBlock, '');
const strayRows = PRESETS.filter(id => new RegExp('^-\\s*id:\\s*' + id + '\\s*$', 'm').test(outside) ||
  new RegExp('^\\s*-\\s*id:\\s*' + id + '\\s*$', 'm').test(outside));
const insideCount = id => (insideBlock.match(new RegExp('id: ' + id + '\\b', 'g')) || []).length;
for (const id of PRESETS) {
  const n = insideCount(id) + (strayRows.includes(id) ? 1 : 0);
  if (strayRows.includes(id)) warn(id + '：块内 ' + insideCount(id) + ' 份 + 块外残留 1 份 → 预设列表会重复');
  else if (n === 0) info(id + '：未安装');
  else if (n > 1) warn(id + '：出现 ' + n + ' 份（重复）');
  else ok(id + '：1 份');
}
if (strayRows.length > 0) problems.push('块外残留 ' + strayRows.length + ' 行（重装即可自动认领）');

// ── 4. !!js ──────────────────────────────────────────────────────────────────
console.log('[4] 非标准 YAML 标签 !!js');
// 注释里出现 !!js 只是文档说明，不算标签
const tagLines = raw.split('\n').map((l, i) => [i + 1, l])
  .filter(([, l]) => l.includes('!!js') && !l.trim().startsWith('#'));
if (tagLines.length === 0) {
  ok('没有 !!js（普通 YAML 解析器可以直接读这个文件）');
} else {
  warn(tagLines.length + ' 处 !!js（第 ' + tagLines.map(([n]) => n).join(', ') + ' 行）');
  info('DSH 加载器能读，但 js-yaml / yamllint / GitHub 预览 / 第三方插件工具都会报 "unknown tag"');
  info('装到用户机器上时应由安装脚本解析成 true/false；用 --fix 就地修');
  problems.push('含 !!js 标签 ' + tagLines.length + ' 处');
}

// ── 5. YAML 能不能被标准解析器读通 ───────────────────────────────────────────
console.log('[5] 标准 YAML 解析');
const require = createRequire(import.meta.url);
const yamlCandidates = [
  path.join(here, '..', 'node_modules', 'js-yaml'),
  path.join(home, 'profiles', 'node_modules', 'js-yaml'),
  '/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/js-yaml',
];
if (process.env.APPDATA) yamlCandidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', 'js-yaml'));
let yaml = null;
for (const c of yamlCandidates) { try { yaml = require(c); break; } catch {} }
if (!yaml) {
  warn('本机没有 js-yaml，跳过（npm i --no-save js-yaml@4）');
} else {
  try {
    const doc = yaml.load(resolvePlatformTags(raw));
    ok('解析通过（顶层 ' + (Array.isArray(doc) ? doc.length + ' 个条目' : typeof doc) + '）');
  } catch (e) {
    bad('解析失败：' + String(e.message).split('\n')[0]);
    problems.push('YAML 解析失败');
  }
}

// ── 6. 可选 dump-config ──────────────────────────────────────────────────────
if (flag('--dump')) {
  console.log('[6] dsh --dump-config 是否认得这些预设');
  try {
    const out = execFileSync('dsh', ['--profile', profile, '--dump-config'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    for (const id of PRESETS) {
      const pkg = 'preset-' + id;
      if (out.includes(pkg)) ok(pkg + ' 出现在合成配置里');
      else warn(pkg + ' 不在合成配置里');
    }
  } catch (e) {
    bad('dump-config 失败：' + String(e.message).split('\n')[0]);
    problems.push('dump-config 失败');
  }
}

// ── --fix ────────────────────────────────────────────────────────────────────
if (flag('--fix')) {
  console.log('[fix] 就地解析 !!js');
  if (!hasPlatformTags(raw)) {
    ok('无需修改');
  } else {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const backup = patchPath + '.bak-doctor-' + stamp;
    fs.writeFileSync(backup, raw, 'utf8');
    fs.writeFileSync(patchPath, resolvePlatformTags(raw), 'utf8');
    ok('已解析并写回；原文件备份到 ' + path.basename(backup));
    info('如需回滚：cp "' + backup + '" "' + patchPath + '"');
  }
}

console.log('');
if (problems.length === 0) {
  console.log('结论：这套预设的安装状态是干净的。如果 GUI 仍然不正常，问题不在这里 ——');
  console.log('      下一步看浏览器 Console 的错误，以及同一份配置下用默认预设是否也异常。');
} else {
  console.log('结论：发现 ' + problems.length + ' 项 —— ' + problems.join('；'));
  console.log('      先跑：node scripts/merge-presets.mjs --patch "' + patchPath + '"   （认领残留、重建托管块）');
  console.log('      再跑：node scripts/doctor.mjs --profile ' + profile + (tagLines.length ? ' --fix' : ''));
  console.log('      仍不对：cp "' + patchPath + '.bak-*" "' + patchPath + '"  回滚到安装前');
}
