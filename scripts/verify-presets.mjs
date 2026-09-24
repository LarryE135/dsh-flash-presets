#!/usr/bin/env node
/**
 * Structural check of the presets — dependency-free, cross-platform (Windows / macOS / Linux).
 *
 * Two layers:
 *   A. 仓库层（在 clone 里运行时）：文件齐不齐、两个安装器是否都调用共享助手、文档版本、本机路径泄漏、
 *      以及那些"换台设备才会炸"的回归（URL.pathname 拼路径、bash-only 安装器、CRLF 检出 .sh）。
 *   B. 安装层：按 $DSH_HOME 判断是 0.1.7+ 的插件行式安装（profile 补丁里的托管块）还是旧版目录式
 *      （.agent-presets/），并断言关键取值。
 *
 *   node scripts/verify-presets.mjs
 *   DSH_HOME=/tmp/dsh node scripts/verify-presets.mjs                   # POSIX
 *   $env:DSH_HOME = "$env:TEMP\dsh"; node scripts\verify-presets.mjs    # Windows
 *   DSH_HOME=/tmp/dsh DSH_PROFILE=headless node scripts/verify-presets.mjs
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

const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const profile = process.env.DSH_PROFILE || 'web';
const patchFile = path.join(dshHome, 'profiles', profile, 'cordis.patch.yml');
const legacyRoot = path.join(dshHome, '.agent-presets');

const EXPECT = {
  'flash-lean': { rules: 11, ptc: false, order: 20 },
  'flash-lean-ptc': { rules: 14, ptc: true, order: 21 },
};
const BEGIN = '# >>> dsh-flash-presets: managed block (0.1.7+ plugin-row presets) >>>';
const END = '# <<< dsh-flash-presets: managed block <<<';

let failed = 0;
const check = (cond, msg) => {
  console.log((cond ? '  ✓ ' : '  ✖ ') + msg);
  if (!cond) failed++;
};
const read = p => (fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf8') : null);
const listScripts = () => (fs.existsSync(here) ? fs.readdirSync(here) : []);

console.log('平台: ' + process.platform + ' / node ' + process.versions.node);
console.log('DSH_HOME: ' + dshHome + '    profile: ' + profile);

// ── A. 仓库层 ────────────────────────────────────────────────────────────────
if (fs.existsSync(path.join(repo, 'presets'))) {
  console.log('\n[仓库]');
  for (const [name, exp] of Object.entries(EXPECT)) {
    const modern = path.join(repo, 'presets', name + '.patch.yml');
    const legacy = path.join(repo, 'presets', 'legacy-0.1.5', name, 'agent.cordis.yml');
    check(read(modern) !== null && fs.statSync(modern).size > 5000,
          'presets/' + name + '.patch.yml（0.1.7+ 插件行式，>5 KB）');
    check(read(legacy) !== null, 'presets/legacy-0.1.5/' + name + '/agent.cordis.yml（旧版回退）');
    const text = read(modern) || '';
    check(!/\/(home|Users)\/[^ ]*\/|[A-Za-z]:\\\\/.test(text), name + '.patch.yml 不含本机绝对路径');
    check(new RegExp('^- insert:$', 'm').test(text), name + '.patch.yml 含行首 - insert: 条目');
  }

  for (const s of ['install.sh', 'install.ps1', 'publish.sh', 'publish.ps1', 'merge-presets.mjs',
                   'verify-presets.mjs', 'verify-yaml.mjs']) {
    check(fs.existsSync(path.join(here, s)), 'scripts/' + s + ' 存在');
  }
  const merge = read(path.join(here, 'merge-presets.mjs')) || '';
  check(/- insert:/.test(merge), 'merge-presets.mjs 会读取预设的 insert 条目');
  const sh = read(path.join(here, 'install.sh')) || '';
  const ps = read(path.join(here, 'install.ps1')) || '';
  check(/merge-presets\.mjs/.test(sh), 'install.sh 调用共享合并实现');
  check(/merge-presets\.mjs/.test(ps), 'install.ps1 调用共享合并实现');
  check(/legacy-0\.1\.5/.test(sh) && /legacy-0\.1\.5/.test(ps), '两个安装器都保留旧版目录回退');
  check(/--uninstall/.test(sh) && /Uninstall/.test(ps), '两个安装器都支持卸载');

  const readme = read(path.join(repo, 'README.md')) || '';
  check(/v1\.1\.0/.test(readme), 'README 标注 v1.1.0');
  check(/0\.1\.7/.test(readme), 'README 说明 0.1.7 的预设机制变化');

  // 换设备才会炸的回归：ESM 路径、bash-only 安装器、CRLF 检出
  const mjs = listScripts().filter(f => f.endsWith('.mjs'));
  const stripComments = src => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const badPattern = new RegExp('import\\.meta\\.url\\)\\.' + 'path' + 'name');
  const badUrl = mjs.filter(f => badPattern.test(stripComments(read(path.join(here, f)) || '')));
  check(badUrl.length === 0, '脚本未用 URL.pathname 拼路径（Windows 上会得到 /D:/…）'
        + (badUrl.length ? '：' + badUrl.join(', ') : ''));
  check(mjs.some(f => /fileURLToPath/.test(read(path.join(here, f)) || '')), '脚本使用 node:url 的 fileURLToPath');
  // macOS 自带 bash 3.2 会把 `$p（` 里的全角括号吞进变量名（Linux 的 bash 5 不会）→
  // 变量后面直接跟非 ASCII 字符时必须写成 ${p}，否则旧版 bash 报 "unbound variable"。
  for (const f of ['install.sh', 'install.ps1']) {
    const text = read(path.join(here, f)) || '';
    const hits = text.match(/\$[A-Za-z_][A-Za-z0-9_]*(?=[^\x00-\x7f])/g) || [];
    check(hits.length === 0, f + ' 的变量在非 ASCII 字符前都加了花括号'
          + (hits.length ? '（发现 ' + hits.slice(0, 3).join(', ') + '）' : ''));
  }
  const ga = read(path.join(repo, '.gitattributes')) || '';
  check(/\*\.sh[^\n]*eol=lf/.test(ga), '.gitattributes 把 *.sh 钉为 LF');
  check(/\.mjs/.test(ga) && /\.yml/.test(ga), '.gitattributes 覆盖 .mjs / .yml');
}

// ── B. 安装层 ────────────────────────────────────────────────────────────────
const modernInstalled = fs.existsSync(patchFile);
const legacyInstalled = fs.existsSync(legacyRoot);
console.log('\n[安装] 检测到: '
  + (modernInstalled ? '插件行式（' + patchFile + '）'
    : legacyInstalled ? '旧版目录式（' + legacyRoot + '）' : '未安装'));

if (modernInstalled) {
  const text = read(patchFile) || '';
  check(text.includes(BEGIN) && text.includes(END), 'profile 补丁里有托管块标记');
  const block = text.includes(BEGIN) && text.includes(END)
    ? text.slice(text.indexOf(BEGIN), text.indexOf(END) + END.length)
    : text;
  for (const [name, exp] of Object.entries(EXPECT)) {
    console.log('\n[' + name + '（已安装）]');
    check(new RegExp('^\\s+- id: preset-' + name + '$', 'm').test(block), '插入行 preset-' + name);
    check(new RegExp('^\\s+id: ' + name + '$', 'm').test(block), 'config.id = ' + name);
    check(new RegExp('^\\s+order: ' + exp.order + '$', 'm').test(block), 'order = ' + exp.order);
    const nums = [...block.matchAll(/^\s+(\d+)\. /gm)].map(m => Number(m[1]));
    check(nums.length >= exp.rules, '规则条数合计 ' + nums.length + '（期望 ≥ ' + exp.rules + '）');
    check(/thresholdRatio: 0\.3/.test(block), '压缩阈值 0.3');
    check(/retainTokens: 50000/.test(block), '保留预算 50000');
    check(/thresholdChars: 8192/.test(block) && /headChars: 4096/.test(block) && /tailChars: 1024/.test(block),
          '裁剪阈值保持 8192/4096/1024');
    check(/id: tool-workflow\n\s+name: '@deepseek-ai\/dsh-tool-workflow'\n\s+disabled: true/.test(block),
          'tool-workflow 已停用');
  }
  const ptcPreset = block.includes('id: tool-presentation') && /mode: ptc/.test(block);
  check(ptcPreset, 'PTC 展示层 mode: ptc');
  check(!/\/(home|Users)\/[^ ]*\/\.dsh\//.test(block), '托管块里未写入本机 DSH_HOME 绝对路径');
} else if (legacyInstalled) {
  for (const [name, exp] of Object.entries(EXPECT)) {
    console.log('\n[' + name + '（已安装 · 旧式）]');
    const dir = path.join(legacyRoot, name);
    const presetYml = read(path.join(dir, 'preset.yml'));
    const compose = read(path.join(dir, 'agent.cordis.yml'));
    check(presetYml !== null, 'preset.yml 存在');
    check(compose !== null, 'agent.cordis.yml 存在');
    if (!compose) continue;
    check(/thresholdRatio:\s*0\.3\b/.test(compose), '压缩阈值 thresholdRatio: 0.3');
    check(/retainTokens:\s*50000\b/.test(compose), '保留预算 retainTokens: 50000');
    const rules = (compose.match(/^\s{6,}\d+\.\s/gm) || []).length;
    check(rules >= exp.rules, 'persona 规则条数 ' + rules + '（期望 ≥ ' + exp.rules + '）');
    check(!/\/(home|Users)\/|[A-Za-z]:\\/.test(compose), '不含本机绝对路径');
    if (exp.ptc) check(/mode:\s*ptc/.test(compose), 'PTC 展示层 mode: ptc');
  }
} else {
  check(false, '未检测到安装（先运行 scripts/install.sh 或 scripts/install.ps1）');
}

console.log('\n' + (failed ? '校验失败：' + failed + ' 项未通过。' : '校验通过：预设结构与跨平台检查全部通过。'));
process.exit(failed ? 1 : 0);
