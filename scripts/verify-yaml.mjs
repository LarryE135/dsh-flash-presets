#!/usr/bin/env node
/**
 * YAML parse + value assertions for the Flash 精简 presets.
 *
 *   node scripts/verify-yaml.mjs                       # 校验仓库里的预设文件（默认）
 *   node scripts/verify-yaml.mjs <file.yml> [...]      # 校验指定文件（安装器用它校验 profile 补丁）
 *
 * Cross-platform (Windows / macOS / Linux): the script directory is resolved with
 * fileURLToPath — `new URL(import.meta.url).pathname` yields `/D:/...` on Windows.
 *
 * js-yaml is looked up in this order:
 *   1. $DSH_JS_YAML
 *   2. this repo's node_modules  (`npm i --no-save js-yaml@4`)
 *   3. next to a globally installed DSH (POSIX and Windows layouts)
 *   4. `npm root -g`
 *
 * `!!js <expr>` 是 DSH 加载器自己的标签（如 `!!js process.platform === 'win32'`），
 * 普通 YAML 解析器不认；这里先替换成字符串再解析，随后做结构与取值断言。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const require = createRequire(import.meta.url);

function loadYaml() {
  const tryRequire = spec => {
    try {
      return { mod: require(spec), from: spec };
    } catch {
      return null;
    }
  };

  if (process.env.DSH_JS_YAML) {
    const hit = tryRequire(process.env.DSH_JS_YAML);
    if (hit) return hit;
    console.log('DSH_JS_YAML 指向的 js-yaml 无法加载，继续按默认顺序查找：' + process.env.DSH_JS_YAML);
  }

  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const candidates = [
    path.join(repo, 'node_modules', 'js-yaml'),
    path.join(here, 'node_modules', 'js-yaml'),
    path.join(home, 'profiles', 'node_modules', 'js-yaml'),
    '/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/js-yaml',
    '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/js-yaml',
  ];
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', 'js-yaml'));
  }
  for (const c of candidates) {
    const hit = tryRequire(c);
    if (hit) return hit;
  }
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const hit = tryRequire(path.join(root, 'js-yaml'));
    if (hit) return hit;
  } catch { /* fallthrough */ }
  return null;
}

const found = loadYaml();
if (!found) {
  console.log('SKIP：未找到 js-yaml（npm i --no-save js-yaml@4，或用 DSH_JS_YAML=<路径> 指定）。');
  process.exit(0);
}
const yaml = found.mod;
console.log('平台: ' + process.platform + ' / node ' + process.versions.node);
console.log('js-yaml: ' + found.from);

const EXPECT = {
  'flash-lean.patch.yml': { preset: 'flash-lean', order: 20, rules: 11, ptcRow: false },
  'flash-lean-ptc.patch.yml': { preset: 'flash-lean-ptc', order: 21, rules: 14, ptcRow: true },
};

let failed = 0;
const check = (cond, msg) => {
  console.log((cond ? '  ✓ ' : '  ✖ ') + msg);
  if (!cond) failed++;
};
const load = file => yaml.load(fs.readFileSync(file, 'utf8').replace(/!!js [^\n]+/g, '"__JS__"'));

// 预设里的行是嵌套的：`cordis:group` 行的 config 本身又是一串行（compaction / delegation 组）。
// 断言时先把它展平，再按 id 查找。
const flatten = rows => (rows || []).flatMap(r => {
  const kids = r && Array.isArray(r.config) ? flatten(r.config) : [];
  return [r, ...kids];
});

function checkPatchFile(file, exp) {
  console.log('\n[' + path.relative(repo, file) + ']');
  let doc;
  try {
    doc = load(file);
  } catch (e) {
    check(false, 'YAML 解析: ' + String(e.message).split('\n')[0]);
    return;
  }
  check(Array.isArray(doc), '顶层是数组');
  const row = (doc || []).flatMap(e => (e && e.insert) || [])
    .find(r => String(r.name || '').includes('@deepseek-ai/dsh-agent-preset'));
  check(!!row, '含 @deepseek-ai/dsh-agent-preset 行');
  if (!row) return;

  const cfg = row.config || {};
  check(cfg.id === exp.preset, 'config.id = ' + cfg.id + '（期望 ' + exp.preset + '）');
  check(cfg.order === exp.order, 'order = ' + cfg.order + '（期望 ' + exp.order + '）');
  check(String(row.id || '').startsWith('preset-'), '行 id 以 preset- 开头（' + row.id + '）');

  const plugins = cfg.plugins || [];
  const flat = flatten(plugins);
  check(plugins.length >= 15, 'plugin 行数 ' + plugins.length + '（期望 ≥ 15）');
  check(flat.length >= plugins.length, '嵌套组可展开（展平后 ' + flat.length + ' 行）');
  const persona = flat.find(p => p.id === 'persona');
  check(!!persona, 'persona 行存在');
  const suffix = (persona && persona.config && persona.config.suffix) || '';
  const nums = [...suffix.matchAll(/^\s*(\d+)\. /gm)].map(m => Number(m[1]));
  check(nums.length === exp.rules, 'persona 规则条数 ' + nums.length + '（期望 ' + exp.rules + '）');
  check(nums.every((n, i) => n === i + 1), 'persona 规则编号连续无重复（1..' + exp.rules + '）');
  check(/Context discipline/.test(suffix) && /Transcript sensitivity/.test(suffix),
        'persona 含 Context discipline / Transcript sensitivity 两条核心规则');

  const cc = (flat.find(p => p.id === 'compaction-basic') || {}).config || {};
  check(cc.thresholdRatio === 0.3, '压缩阈值 thresholdRatio = ' + cc.thresholdRatio);
  check(cc.retainTokens === 50000, '保留预算 retainTokens = ' + cc.retainTokens);
  const pc = (flat.find(p => p.id === 'tool-result-pruner') || {}).config || {};
  check(pc.thresholdChars === 8192 && pc.headChars === 4096 && pc.tailChars === 1024,
        '裁剪阈值保持出厂默认 8192/4096/1024');

  const wf = flat.find(p => p.id === 'tool-workflow');
  check(!!wf && wf.disabled === true, 'tool-workflow 已停用');
  const ralph = flat.find(p => p.id === 'tool-ralph');
  check(!!ralph && ralph.disabled === true, 'tool-ralph 已停用');

  const present = flat.find(p => p.id === 'tool-presentation');
  if (exp.ptcRow) {
    check(!!present && present.config && present.config.mode === 'ptc', 'PTC 展示层 tool-presentation: mode ptc');
  } else {
    check(!present, '不含 PTC 展示层（精简版为纯工具面）');
  }
  check(!/\/(home|Users)\/|[A-Za-z]:\\\\/.test(fs.readFileSync(file, 'utf8')), '不含本机绝对路径');
}

const args = process.argv.slice(2);
if (args.length) {
  // 安装器路径：校验目标文件（profile 补丁）——硬断言只有“能解析 + 含我们的两个预设行”
  for (const raw of args) {
    const file = path.resolve(raw);
    console.log('\n[' + file + ']');
    let doc = null;
    try {
      doc = load(file);
    } catch (e) {
      check(false, 'YAML 解析: ' + String(e.message).split('\n')[0]);
      continue;
    }
    check(Array.isArray(doc), '顶层是数组');
    const rows = ((doc || []).flatMap(e => (e && e.insert) || []))
      .filter(r => String(r.name || '').includes('@deepseek-ai/dsh-agent-preset'))
      .map(r => (r.config || {}).id);
    check(rows.includes('flash-lean') && rows.includes('flash-lean-ptc'),
          '含两个预设行（实际: ' + (rows.join(', ') || '无') + '）');
  }
} else {
  for (const [name, exp] of Object.entries(EXPECT)) {
    const file = path.join(repo, 'presets', name);
    if (!fs.existsSync(file)) { console.log('\n[' + name + ']'); check(false, '文件缺失'); continue; }
    checkPatchFile(file, exp);
  }
  console.log('\n[presets/legacy-0.1.5（DSH < 0.1.7 回退用）]');
  for (const exp of Object.values(EXPECT)) {
    const legacy = path.join(repo, 'presets', 'legacy-0.1.5', exp.preset, 'agent.cordis.yml');
    if (!fs.existsSync(legacy)) { check(false, '缺少 ' + exp.preset + '/agent.cordis.yml'); continue; }
    const text = fs.readFileSync(legacy, 'utf8');
    check(/thresholdRatio:\s*0\.3\b/.test(text) && /retainTokens:\s*50000\b/.test(text),
          exp.preset + '：旧式文件仍带 0.3 / 50000');
  }
}

console.log('\n' + (failed ? 'YAML 校验失败：' + failed + ' 项。' : 'YAML 校验通过。'));
process.exit(failed ? 1 : 0);
