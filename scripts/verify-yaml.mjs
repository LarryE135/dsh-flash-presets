#!/usr/bin/env node
/**
 * Parse both preset files with js-yaml and assert the tuned values.
 * js-yaml is resolved from, in order: local node_modules, the DSH installation,
 * DSH_JS_YAML. If none is found the script prints SKIP and exits 0.
 *
 *   node scripts/verify-yaml.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.join(here, '..');
const require = createRequire(import.meta.url);

function loadYaml() {
  const candidates = [
    process.env.DSH_JS_YAML,
    '/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/js-yaml',
    '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/js-yaml',
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch { /* keep looking */ }
  }
  try { return require('js-yaml'); } catch { /* fall through to skip */ }
  return null;
}

const yaml = loadYaml();
if (yaml === null) {
  console.log('SKIP: js-yaml 不可用（CI 里用 `npm i --no-save js-yaml` 安装；本地可 export DSH_JS_YAML=<path>）');
  process.exit(0);
}

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
