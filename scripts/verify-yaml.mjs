#!/usr/bin/env node
/**
 * Parse both preset files with js-yaml and assert the tuned values.
 * Cross-platform (Windows / macOS / Linux): the script directory is resolved with
 * fileURLToPath — `new URL(import.meta.url).pathname` yields `/D:/...` on Windows and
 * would send readFileSync to `D:\D:\...` (ENOENT).
 *
 * js-yaml is looked up in this order:
 *   1. $DSH_JS_YAML
 *   2. this repo's node_modules / any ancestor node_modules   (`npm i --no-save js-yaml@4`)
 *   3. next to a globally installed DSH (POSIX and Windows layouts)
 *   4. `npm root -g`
 * If nothing is found the script prints SKIP and exits 0.
 *
 *   node scripts/verify-yaml.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

  // 2) repo-local / ancestor node_modules (works on every OS)
  const local = tryRequire('js-yaml');
  if (local) return local;

  // 3) beside a global DSH installation
  const globalRoots = [
    '/usr/lib/node_modules',
    '/usr/local/lib/node_modules',
    '/opt/homebrew/lib/node_modules',
    path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node_modules'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules'),
  ];
  for (const root of globalRoots) {
    for (const rel of ['js-yaml', path.join('@deepseek-ai', 'dsh', 'node_modules', 'js-yaml')]) {
      const candidate = path.join(root, rel);
      if (!fs.existsSync(candidate)) continue;
      const hit = tryRequire(candidate);
      if (hit) return hit;
    }
  }

  // 4) ask npm where the global root is (prefixes vary per OS and per install method)
  try {
    const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const r = spawnSync(cmd, ['root', '-g'], { encoding: 'utf8', timeout: 15000 });
    const out = (r.stdout || '').trim();
    if (out) {
      for (const rel of ['js-yaml', path.join('@deepseek-ai', 'dsh', 'node_modules', 'js-yaml')]) {
        const candidate = path.join(out, rel);
        if (!fs.existsSync(candidate)) continue;
        const hit = tryRequire(candidate);
        if (hit) return hit;
      }
    }
  } catch { /* fall through to skip */ }

  return null;
}

const loaded = loadYaml();
if (loaded === null) {
  console.log('SKIP: js-yaml 不可用。装法（任选）：');
  console.log('  - 本仓库内安装：npm install --no-save js-yaml@4');
  console.log(process.platform === 'win32'
    ? '  - 或指向已有的副本：$env:DSH_JS_YAML = "C:\\path\\to\\js-yaml"'
    : '  - 或指向已有的副本：export DSH_JS_YAML=/path/to/js-yaml');
  process.exit(0);
}
const yaml = loaded.mod;
console.log('js-yaml 来自: ' + loaded.from);

const Schema = yaml.DEFAULT_SCHEMA.extend({
  explicit: [new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', resolve: () => true, construct: d => String(d) })],
});

let failed = 0;
const check = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✖ ') + msg); if (!cond) failed++; };
const rows = doc => {
  const out = [];
  const walk = (list, prefix = '') => {
    for (const row of list ?? []) {
      out.push({ id: prefix + row.id, disabled: !!row.disabled, config: row.config });
      if (Array.isArray(row.config)) walk(row.config, prefix + row.id + '/');
    }
  };
  walk(doc);
  return out;
};

for (const name of ['flash-lean', 'flash-lean-ptc']) {
  console.log('\n[' + name + ']');
  const file = path.join(repo, 'presets', name, 'agent.cordis.yml');
  check(fs.existsSync(file), '找到 ' + path.relative(repo, file).split(path.sep).join('/'));
  if (!fs.existsSync(file)) continue;
  const doc = yaml.load(fs.readFileSync(file, 'utf8'), { schema: Schema });
  const list = rows(doc);
  // Row ids are prefixed by their group in the composed tree (e.g. `delegation/tool-ralph`),
  // so match on the full id first and then on any group-qualified suffix.
  const find = id => list.find(r => r.id === id) ?? list.find(r => r.id.endsWith('/' + id));
  const meta = yaml.load(fs.readFileSync(path.join(repo, 'presets', name, 'preset.yml'), 'utf8'));
  check(list.length > 10, 'composed rows: ' + list.length);
  check(typeof meta.name === 'string' && meta.name.length > 0, 'preset.yml name = ' + meta.name);
  const compaction = find('compaction-basic');
  check(compaction?.config?.thresholdRatio === 0.3, 'thresholdRatio = 0.3');
  check(compaction?.config?.retainTokens === 50000, 'retainTokens = 50000');
  const pruner = find('tool-result-pruner');
  check(pruner?.config?.thresholdChars === 8192 && pruner?.config?.headChars === 4096
        && pruner?.config?.tailChars === 1024, 'pruner = 8192/4096/1024（保持默认）');
  check(find('tool-workflow')?.disabled === true, 'tool-workflow disabled');
  check(find('tool-ralph')?.disabled === true, 'tool-ralph disabled');
  const presentation = find('tool-presentation');
  check(!!presentation === (name.endsWith('ptc')), 'tool-presentation ' + (name.endsWith('ptc') ? '存在' : '不存在'));
  if (presentation) check(presentation.config?.mode === 'ptc', 'tool-presentation mode = ptc');
  const persona = find('persona');
  const suffix = persona?.config?.suffix ?? '';
  const ruleCount = (suffix.match(/^\s*\d+\.\s/gm) || []).length;
  check(ruleCount >= (name.endsWith('ptc') ? 14 : 11), 'persona 规则条数 ' + ruleCount);
}

console.log(failed === 0 ? '\nYAML 校验通过。' : '\nYAML 校验失败：' + failed + ' 项。');
process.exit(failed === 0 ? 0 : 1);
