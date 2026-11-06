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
import { resolvePlatformTags, hasPlatformTags } from './platform-tags.mjs';
import { loadAliasMap } from '../lib/preset-alias.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const flag = n => argv.includes(n);

const BEGIN = '# >>> dsh-flash-presets: managed block (0.1.7+ plugin-row presets) >>>';
const END = '# <<< dsh-flash-presets: managed block <<<';
// 现役两个预设由补丁层/组合包提供；历史 id 只由运行时兼容层解析，不写入补丁（R3-9）。
const CURRENT = ['flash-lean-ptc-v3', 'flash-lean-ptc-v3-balance'];
// 兼容卡：0.2.5 原规则的两张卡，合法地出现在补丁层里（不算历史 id，也不算现役）
const COMPAT_CARDS = ['flash-lean-ptc-v1', 'flash-lean-ptc-v2'];
// 0.2.9 起 lite 的 id 回归 flash-lean-ptc-v3；0.2.7–0.2.8 的 -lite 变成历史 id。
// v1/v2 已作为真实兼容卡进补丁层，不再算历史 id；真正靠别名解析的只剩这三个。
const LEGACY_IDS = ['flash-lean', 'flash-lean-ptc', 'flash-lean-ptc-v3-lite'];
const PRESETS = [...CURRENT, ...LEGACY_IDS];

if (argv.includes('--help') || argv.includes('-h')) {
  console.log([
    'dsh-flash-presets doctor —— 体检这套预设的安装状态（只读；除 --fix 外不改文件）',
    '',
    '  node scripts/doctor.mjs [选项]',
    '',
    '  --profile <名称>   profile 名，默认 web',
    '  --patch <路径>     直接指定补丁文件（默认 $DSH_HOME/profiles/<profile>/cordis.patch.yml）',
    '  --all              全部检查（含 --sessions 与 --dump）',
    '  --dump             顺带跑 dsh --dump-config，确认合成配置认得这些预设',
    '  --sessions         检查旧会话的 preset id（只读扫描，不改写任何会话文件）',
    '  --fix              把 !!js 平台标签解析成普通值后写回（写前备份）',
    '  --warn-only        发现问题也退出 0（默认退出码 1）',
    '  -h, --help         打印本帮助',
    '',
    '退出码：0 干净（或 --warn-only）· 1 发现 problems · 2 参数/环境错误',
  ].join('\n'));
  process.exit(0);
}

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
// 0.2.6 起预设也可以完全由组合包提供（dsh plugin add dsh-flash-presets），此时没有托管块。
const bundleInstalled = (() => {
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(home, 'profiles', profile, 'package.json'), 'utf8'));
    const bundles = (pj.dsh && pj.dsh.profile && pj.dsh.profile.bundles) || [];
    return bundles.includes('dsh-flash-presets');
  } catch { return false; }
})();
const blocks = raw.split('\n').filter(l => l.trim() === BEGIN).length;
const ends = raw.split('\n').filter(l => l.trim() === END).length;
if (blocks === 0) {
  if (bundleInstalled) ok('没有托管块，但组合包 dsh-flash-presets 已装 —— 预设行由 bundle 提供');
  else warn('没有托管块 —— 这些预设不是用本仓库的安装脚本装的（可能是手抄或 bundle patch）');
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
// (?![\w-]) 而不是 \\b：`id: flash-lean-ptc-v3` 是 `-v3-lite` / `-v3-balance` 的子串，
// 用 \\b 会把三个预设算成一个。
const insideCount = id => (insideBlock.match(new RegExp('id: ' + id + '(?![\\w-])', 'g')) || []).length;
for (const id of CURRENT) {
  const n = insideCount(id) + (strayRows.includes(id) ? 1 : 0);
  if (strayRows.includes(id)) warn(id + '：块内 ' + insideCount(id) + ' 份 + 块外残留 1 份 → 预设列表会重复');
  else if (n === 0 && bundleInstalled) ok(id + '：由组合包 dsh-flash-presets 提供');
  else if (n === 0) info(id + '：未安装');
  else if (n > 1) warn(id + '：出现 ' + n + ' 份（重复）');
  else ok(id + '：1 份');
}
// 历史 id 不写入补丁层（组合包里也没有这一行），出现才提示（R3-9）。
for (const id of LEGACY_IDS) {
  const n = insideCount(id) + (strayRows.includes(id) ? 1 : 0);
  if (n > 0) warn(id + '：历史 id 不该写进补丁层（由兼容层解析），请删掉这 ' + n + ' 行');
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

// ── 6. 计划模式插件（可选组件）──────────────────────────────────────────────
console.log('[6] 计划模式组件（plan-mode v1，随 dsh-flash-presets 提供）');
const PLUGIN = 'dsh-flash-presets';
// 安装命令一律钉版本：裸包名在 npm 上可能是旧版本（R2-3）。版本号从本包的 package.json 读，不写死。
const pinnedSpec = () => {
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
    return 'github:LarryE135/dsh-flash-presets#v' + pj.version;
  } catch {
    return 'github:LarryE135/dsh-flash-presets#v<本包版本>';
  }
};
const profileDir = path.join(home, 'profiles', profile);
const pluginDir = path.join(profileDir, 'node_modules', PLUGIN);
if (fs.existsSync(path.join(pluginDir, 'package.json'))) {
  let pv = '?';
  try { pv = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf8')).version; } catch {}
  ok('已装 ' + PLUGIN + '@' + pv);
  if (fs.existsSync(path.join(pluginDir, 'lib', 'client.js'))) ok('客户端入口存在（lib/client.js）');
  else { warn('缺少 lib/client.js —— 客户端不会加载'); problems.push('插件客户端入口缺失'); }
  if (fs.existsSync(path.join(pluginDir, 'lib', 'index.js'))) ok('宿主入口存在（lib/index.js）');
  else { warn('缺少 lib/index.js —— 计划模式组件不会加载'); problems.push('计划模式宿主入口缺失'); }
} else {
  let dep = null;
  try {
    const pkgFile = path.join(profileDir, 'package.json');
    if (fs.existsSync(pkgFile)) {
      const pj = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
      dep = (pj.dependencies || {})[PLUGIN] || null;
    }
  } catch {}
  if (dep) {
    warn('profile 依赖里有 ' + PLUGIN + '@' + dep + '，但 node_modules 里没有 —— 重装一次：dsh plugin --profile ' + profile + ' add ' + PLUGIN);
    problems.push('插件声明存在但未落盘');
  } else {
    if (blocks > 0) {
      // 脚本安装的 profile：不能照「add <裸包名>」装第二遍 —— 会和托管块里的两行叠成重复注册（R2-3）。
      warn('本包未装成插件卡（当前是脚本安装：托管块里是两个预设行）');
      info('计划模式组件、旧 id 兼容层、glob/grep 只读并发只随插件卡提供。要换插件卡，先卸掉脚本写的行：');
      info('  bash scripts/install.sh --profile ' + profile + ' --uninstall');
      info('  dsh plugin --profile ' + profile + ' add ' + pinnedSpec());
    } else {
      warn('本包未安装：dsh plugin --profile ' + profile + ' add ' + pinnedSpec());
    }
  }
}
const stateFile = path.join(home, 'plan-mode-ui', 'state.json');
if (fs.existsSync(stateFile)) {
  try {
    const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const n = st && st.sessions ? Object.keys(st.sessions).length : 0;
    ok('状态文件有 ' + n + ' 条会话记录（最多 50 条，LRU 淘汰）');
  } catch { warn('状态文件存在但解析失败：' + stateFile); }
}

// ── 7. 旧会话的预设 id ──────────────────────────────────────────────────────
// 会话把预设 id 写进 header；0.2.6 改了 id，旧会话不迁移就解析不到（一次性 runner 直接拒绝）。
console.log('[7] 旧会话的预设 id');
if (!flag('--sessions') && !flag('--all')) {
  info('跳过（加 --sessions 或 --all 才扫会话；' + path.join(home, 'sessions') + '）');
} else {
  // 扫描器只在仓库里存在（会写会话的迁移脚本不随包发布）：import 失败不能把 doctor 带崩。
  let scanSessions = null;
  try { ({ scanSessions } = await import('./migrate-legacy-preset-ids.mjs')); } catch { scanSessions = null; }
  if (typeof scanSessions !== 'function') {
    const ids = (() => { try { return Object.keys(loadAliasMap().aliases); } catch { return []; } })();
    info('本份安装没有带旧会话扫描器（随包只发布只读组件）');
    info('旧 id 由运行时兼容层解析，会话无需迁移：' + (ids.length ? ids.join('、') : '见 presets/legacy-preset-map.json'));
  } else {
    const scan = await scanSessions(home);
    const pending = [...scan.legacy].map(([id, files]) => [id, files.length]);
    if (!scan.files) warn('没有会话目录：' + path.join(home, 'sessions'));
    else if (!pending.length) ok(scan.files + ' 个会话文件，全部指向现役预设');
    else {
      const total = pending.reduce((n, [, c]) => n + c, 0);
      info(total + '/' + scan.files + ' 个会话仍记着旧 id：' + pending.map(([id, c]) => id + ' ×' + c).join('、'));
      ok('无需处理：这些 id 由运行时兼容层解析（presets/legacy-preset-map.json），不改写任何会话文件');
    }
  }
}

// ── 8. 可选 dump-config ──────────────────────────────────────────────────────
if (flag('--dump') || flag('--all')) {
  console.log('[8] dsh --dump-config 是否认得这些预设');
  try {
    const out = execFileSync('dsh', ['--profile', profile, '--dump-config'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    // 精确匹配整行，避免 `preset-flash-lean-ptc-v3` 命中 `-v3-lite` / `-v3-balance`。
    const hasRow = (id) => new RegExp('^\\s*-\\s*id:\\s*preset-' + id + '\\s*$', 'm').test(out);
    const CURATED = ['flash-lean-ptc-v3', 'flash-lean-ptc-v3-balance'];
    for (const id of CURATED) {
      if (hasRow(id)) ok('preset-' + id + ' 出现在合成配置里');
      else warn('preset-' + id + ' 不在合成配置里');
    }
    for (const id of COMPAT_CARDS) {
      if (hasRow(id)) ok('preset-' + id + ' 是兼容卡（0.2.5 原规则），出现在合成配置里属正常');
      else info('preset-' + id + ' 兼容卡不在合成配置里（装的是没有兼容卡的旧版？）');
    }
    for (const id of PRESETS.filter((x) => !CURATED.includes(x))) {
      if (hasRow(id)) warn('preset-' + id + ' 是历史 id，不应出现在合成配置里');
      else ok('preset-' + id + ' 未出现（历史 id，由兼容层解析）');
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
// 有 problems 时退出码 1：CI 与「体检」才能真正失败（第三轮审计 R3-8）。
// --warn-only 保留旧的「只看输出、不影响退出码」用法。
if (problems.length > 0 && !flag('--warn-only')) process.exitCode = 1;
