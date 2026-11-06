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
  console.log('退出码 2 = 跳过，不等于通过。');
  process.exit(2);
}
const yaml = found.mod;
console.log('平台: ' + process.platform + ' / node ' + process.versions.node);
console.log('js-yaml: ' + found.from);

const EXPECT = {
  'flash-lean-ptc-v3.patch.yml': {
    preset: 'flash-lean-ptc-v3', order: 27, rules: 13, ptcRow: true,
    thresholdRatio: 0.25, retainTokens: 20000, compactionRetries: 1,
  },
  'flash-lean-ptc-v3-balance.patch.yml': {
    preset: 'flash-lean-ptc-v3-balance', order: 26, rules: 3, ptcRow: true,
    thresholdRatio: 0.25, retainTokens: 20000, compactionRetries: 1,
  },
};
// 合成产物只发这两个（0.2.9 起发行包收窄；v1/v2/v3b/v3e 不随包发行）
const BUNDLE_IDS = ['flash-lean-ptc-v3', 'flash-lean-ptc-v3-balance'];
const EXPECT_IDS = BUNDLE_IDS;

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
  // DSH 0.2.2-rc.1 起 list_agents 并入 @deepseek-ai/dsh-tool-subagent-control 主插件，
  // 子路径 ./list-agents 已从 exports 移除；再声明这一行会让整份预设 mount 失败，
  // GUI 的「Agent 预设」卡片显示「加载失败」（0.2.6 发布前的实际故障，见 CHANGELOG）。
  const removedPluginNames = ['@deepseek-ai/dsh-tool-subagent-control/list-agents'];
  const staleRows = flat.filter(p => removedPluginNames.includes(String((p && p.name) || '')));
  check(staleRows.length === 0, '不引用上游已移除的插件子路径（list-agents）');
  const persona = flat.find(p => p.id === 'persona');
  // rules === 0 的无人格对照版本已移出发布包；保留该分支以兼容历史源文件。
  if (exp.rules === 0) {
    check(!persona, 'persona 行不存在（对照版 none）');
  } else {
    check(!!persona, 'persona 行存在');
    const suffix = (persona && persona.config && persona.config.suffix) || '';
    const nums = [...suffix.matchAll(/^\s*(\d+)\. /gm)].map(m => Number(m[1]));
    check(nums.length === exp.rules, 'persona 规则条数 ' + nums.length + '（期望 ' + exp.rules + '）');
    check(nums.every((n, i) => n === i + 1), 'persona 规则编号连续无重复（1..' + exp.rules + '）');
    // 上下文纪律 / 转录敏感是 v3 与 v3 max 的必备两条；lite 只保留引擎无法替代的部分。
    if (exp.rules >= 7) {
      check(/Context discipline/.test(suffix) && /(Transcript sensitivity|Never put secrets, tokens)/.test(suffix),
            'persona 含上下文纪律 / 转录敏感两条核心规则');
    } else {
      check(/Never put secrets, tokens/.test(suffix), 'persona 含转录敏感（不写入密钥）一条');
    }
  }

  const cc = (flat.find(p => p.id === 'compaction-basic') || {}).config || {};
  check(cc.thresholdRatio === exp.thresholdRatio, '压缩阈值 thresholdRatio = ' + cc.thresholdRatio + '（期望 ' + exp.thresholdRatio + '）');
  check(cc.retainTokens === exp.retainTokens, '保留预算 retainTokens = ' + cc.retainTokens + '（期望 ' + exp.retainTokens + '）');
  check(cc.compactionRetries === exp.compactionRetries, '压缩重试 compactionRetries = ' + cc.compactionRetries + '（期望 ' + exp.compactionRetries + '）');
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
    // 安装目标（profile 补丁）必须含三行；候选/实验文件不含我们的预设行是正常的，
    // 以前一律硬断言，导致 candidates/*.yml 全被误判为"校验失败"
    const isInstallTarget = rows.length > 0 || /[\\/]profiles[\\/]/.test(file);
    if (isInstallTarget) {
      // 发行包只提供 v3 与 balance；其余 id 若出现，只能是使用者自己在 profile 层加的兼容行
      check(rows.includes('flash-lean-ptc-v3'),
            '含 v3 预设行（实际: ' + (rows.join(', ') || '无') + '）');
      const known = ['flash-lean-ptc-v3', 'flash-lean-ptc-v3-balance'];
      check(rows.every(id => known.includes(id)),
            '预设行只来自本包（实际: ' + (rows.join(', ') || '无') + '）');
    } else {
      console.log('  · 非安装目标（不含本仓库预设行），跳过预设行断言');
    }
  }
} else {
  for (const [name, exp] of Object.entries(EXPECT)) {
    const file = path.join(repo, 'presets', name);
    if (!fs.existsSync(file)) { console.log('\n[' + name + ']'); check(false, '文件缺失'); continue; }
    checkPatchFile(file, exp);
  }
  console.log('\n[cordis.patch.yml（合成产物）]');
  {
    const composed = path.join(repo, 'cordis.patch.yml');
    if (!fs.existsSync(composed)) {
      check(false, '合成产物缺失');
    } else {
      let cdoc = null;
      try {
        cdoc = load(composed);
        check(true, '可被 YAML 解析');
      } catch (e) {
        check(false, 'YAML 解析: ' + String(e.message).split('\n')[0]);
      }
      if (cdoc) {
        const ids = (cdoc || []).flatMap(e => (e && e.insert) || [])
          .filter(r => String(r.name || '').includes('@deepseek-ai/dsh-agent-preset'))
          .map(r => (r.config || {}).id);
        // 0.2.5 起 bundle 默认只发 v3；同时反向断言别把 v1/v2 又混进来
        check(EXPECT_IDS.every(id => ids.includes(id)),
              '合成产物含 ' + EXPECT_IDS.join('/') + '（实际: ' + (ids.join(', ') || '无') + '）');
        check(ids.length === EXPECT_IDS.length,
              '合成产物只含 ' + EXPECT_IDS.join('/') + '，不含对照版本（实际: ' + (ids.join(', ') || '无') + '）');
        // 计划模式是第三个组件：必须恰好一行 plan-mode-ui，且 name 指向本包（模块入口在 lib/index.js）。
        const pluginRows = (cdoc || []).flatMap(e => (e && e.insert) || []).filter(r => r && r.id === 'plan-mode-ui');
        check(pluginRows.length === 1,
              '合成产物恰好一行 plan-mode-ui（实际 ' + pluginRows.length + ' 行）');
        check(pluginRows[0] && pluginRows[0].name === 'dsh-flash-presets',
              'plan-mode-ui 行指向本包 dsh-flash-presets');
        check(!String(JSON.stringify(pluginRows)).includes('dsh-plan-mode-ui'),
              '合成产物不再引用独立包 dsh-plan-mode-ui');
        // 客户端 bundle 的注册 id 必须等于包名：DSH 的 boot graph 用包名做行 id，
        // 写错就会 materialize 不到 factory，页面停在 “Failed to load plugins”（0.2.6 的事故）。
        const clientBundle = fs.existsSync(path.join(repo, 'lib', 'client.js'))
          ? fs.readFileSync(path.join(repo, 'lib', 'client.js'), 'utf8') : '';
        const regId = (clientBundle.match(/__ModuleLoader__\.load\(\{\s*id:\s*["']([^"']+)["']/) || [])[1] || '';
        check(regId === 'dsh-flash-presets',
              'lib/client.js 的注册 id = 包名（实际: ' + (regId || '未找到') + '）');
        const runtimeRows = (cdoc || []).filter(e => e && e.id === 'ptc-runtime' && e.insert === undefined);
        check(runtimeRows.length === 1 && JSON.stringify(runtimeRows[0]).includes('persistent-in-memory'),
              '运行时覆盖恰好一条 ptc-runtime → persistent-in-memory');
      }
    }
  }
  check(!fs.existsSync(path.join(repo, 'presets', 'legacy-0.1.5')),
        '旧式目录 presets/legacy-0.1.5 已移除（0.2.6 起只保留 v3 与 v3 lite 两个插件行式预设）');
}

console.log('\n' + (failed ? 'YAML 校验失败：' + failed + ' 项。' : 'YAML 校验通过。'));
process.exit(failed ? 1 : 0);
