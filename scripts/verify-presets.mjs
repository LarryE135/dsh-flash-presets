#!/usr/bin/env node
/**
 * Structural check of the presets — dependency-free, cross-platform (Windows / macOS / Linux).
 *
 * Checks the INSTALLED presets (under $DSH_HOME/.agent-presets) and, when run from a clone,
 * a set of repo-level regression guards (the ones that would break a fresh clone on another OS).
 *
 *   node scripts/verify-presets.mjs
 *   DSH_HOME=/tmp/dsh node scripts/verify-presets.mjs          # POSIX
 *   $env:DSH_HOME = "$env:TEMP\dsh"; node scripts\verify-presets.mjs   # Windows
 *
 * Exit code 0 = every check passed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// NOTE: always resolve the script directory with fileURLToPath — on Windows
// `new URL(import.meta.url).pathname` yields `/D:/...`, and path.join then builds `D:\D:\...`.
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');

const root = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), '.agent-presets');
const EXPECT = {
  'flash-lean':     { rules: 11, ptc: false },
  'flash-lean-ptc': { rules: 14, ptc: true },
};

let failed = 0;
const check = (cond, msg) => {
  console.log((cond ? '  ✓ ' : '  ✖ ') + msg);
  if (!cond) failed++;
};
const read = p => (fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf8') : null);
const listScripts = () => (fs.existsSync(here) ? fs.readdirSync(here) : []);

console.log('平台: ' + process.platform + ' / node ' + process.versions.node);
console.log('预设目录: ' + root);
check(fs.existsSync(root), '预设目录存在（先运行 scripts/install.sh 或 scripts/install.ps1）');

for (const [name, exp] of Object.entries(EXPECT)) {
  console.log('\n[' + name + ']');
  const dir = path.join(root, name);
  const presetYml = read(path.join(dir, 'preset.yml'));
  const compose = read(path.join(dir, 'agent.cordis.yml'));
  check(presetYml !== null, 'preset.yml 存在');
  check(compose !== null, 'agent.cordis.yml 存在');
  if (presetYml === null || compose === null) continue;
  check(/^name:\s*\S/m.test(presetYml), 'preset.yml 含 name');
  check(presetYml.length > 60, 'preset.yml 含描述');
  check(/thresholdRatio:\s*0\.3\b/.test(compose), '压缩阈值 thresholdRatio: 0.3');
  check(/retainTokens:\s*50000\b/.test(compose), '保留预算 retainTokens: 50000');
  check(/thresholdChars:\s*8192\b/.test(compose) && /headChars:\s*4096\b/.test(compose)
        && /tailChars:\s*1024\b/.test(compose), '裁剪阈值保持默认 8192/4096/1024');
  check(!/\/home\/|\/Users\/|[A-Za-z]:\\/.test(compose), '不含本机绝对路径（POSIX 或 Windows 形式）');
  const rules = (compose.match(/^\s{6,}\d+\.\s/gm) || []).length;
  check(rules >= exp.rules, 'persona 规则条数 ' + rules + '（期望 ≥ ' + exp.rules + '）');
  check(/Context discipline/.test(compose), '含「Context discipline」规则');
  check(/Transcript sensitivity/.test(compose), '含「Transcript sensitivity」规则');
  const disabled = id => new RegExp('- id: ' + id + '\\n(?:[^\\n]*\\n)*?\\s*disabled: true').test(compose);
  check(disabled('tool-workflow'), 'tool-workflow 已禁用');
  check(disabled('tool-ralph'), 'tool-ralph 已禁用');
  check(/agent-instructions/.test(compose), '保留 agent-instructions（全局指令仍会注入）');
  check(/mode:\s*ptc/.test(compose) === exp.ptc, 'tool-presentation mode=ptc ' + (exp.ptc ? '在本预设' : '不在本预设'));
}

// ---------------------------------------------------------------- repo guards
// These catch the failures seen on a second device: an ESM path bug that only bites
// on Windows, a bash-only installer with no PowerShell twin, and CRLF checkout of .sh.
if (fs.existsSync(path.join(repo, 'presets'))) {
  console.log('\n[repo] 跨平台与回归检查');
  for (const s of ['install.sh', 'install.ps1', 'publish.sh', 'publish.ps1', 'verify-presets.mjs', 'verify-yaml.mjs']) {
    check(fs.existsSync(path.join(here, s)), 'scripts/' + s + ' 存在');
  }
  const mjs = listScripts().filter(f => f.endsWith('.mjs'));
  // Strip comments first: the scripts document this anti-pattern in prose, and a naive
  // text search would flag the documentation itself. The needle is assembled from two
  // halves so that this file cannot match its own pattern either.
  const stripComments = src => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const badPattern = new RegExp('import\\.meta\\.url\\)\\.' + 'path' + 'name');
  const badUrl = mjs.filter(f => badPattern.test(stripComments(read(path.join(here, f)) || '')));
  check(badUrl.length === 0, '脚本未用 URL.pathname 拼路径（Windows 上会得到 /D:/…）'
        + (badUrl.length ? '：' + badUrl.join(', ') : ''));
  check(mjs.some(f => /fileURLToPath/.test(read(path.join(here, f)) || '')), '脚本使用 node:url 的 fileURLToPath');
  const ga = read(path.join(repo, '.gitattributes'));
  check(ga !== null && /\*\.sh[^\n]*eol=lf/.test(ga), '.gitattributes 把 *.sh 钉为 LF（Windows 克隆后仍能 bash 运行）');
  const sh = read(path.join(here, 'install.sh')) || '';
  const ps = read(path.join(here, 'install.ps1')) || '';
  for (const name of Object.keys(EXPECT)) {
    check(sh.includes(name), 'install.sh 覆盖 ' + name);
    check(ps.includes(name), 'install.ps1 覆盖 ' + name);
    check(fs.existsSync(path.join(repo, 'presets', name, 'agent.cordis.yml')), '仓库内含 presets/' + name);
  }
}

console.log(failed === 0 ? '\n校验通过：预设结构与跨平台检查全部通过。' : '\n校验失败：' + failed + ' 项未通过。');
process.exit(failed === 0 ? 0 : 1);
