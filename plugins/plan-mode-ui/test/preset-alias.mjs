// preset-alias 回归测试：别名层的行为契约（第五轮审计 T0-2 / T1-1 / T1-2 / T2-1 / T2-2 / T3-2 都钉在这里）。
//
// 这里用假 registry，不依赖 DSH 运行时：CI 与本地都能跑。
//   - 历史 id（含 -lite / v1 / v2 / flash-lean / flash-lean-ptc）都必须解析到 canonical；
//   - resolve(id) / resolve()（默认 id 本身是历史 id）都要能出来 —— T1-2 的场景；
//   - mount/select 只有在 id **真的没定义**时才换成 canonical（T2-2：不许劫持用户自己建的同名预设）；
//   - 完全陌生的 id 必须照原样抛 not-found；
//   - 上游同步函数必须仍然同步返回（返回 Promise 会把调用方全打坏）；
//   - rulesDiffer 的别名首次命中要打印警告（T0-2：规则变化必须可见）。
import assert from 'node:assert/strict';
import { loadAliasMap, installPresetAliases } from '../lib/preset-alias.js';

const map = loadAliasMap();
assert.ok(map !== null, 'legacy-preset-map.json 必须能被读到');
assert.equal(map.canonical, 'flash-lean-ptc-v3');
for (const id of ['flash-lean-ptc-v3-lite', 'flash-lean-ptc-v1', 'flash-lean-ptc-v2', 'flash-lean-ptc', 'flash-lean']) {
  assert.ok(Object.prototype.hasOwnProperty.call(map.aliases, id), '别名表必须含 ' + id);
}
assert.equal(map.aliases['flash-lean-ptc-v3-lite'].rulesDiffer, false);
assert.equal(map.aliases['flash-lean-ptc-v1'].rulesDiffer, true);
assert.equal(map.aliases['flash-lean-ptc-v2'].rulesDiffer, true);

const notFound = (id) => Object.assign(new Error('Unknown agent preset: ' + id), { code: 'agent-preset/not-found' });

function makeService() {
  const definitions = new Map([['flash-lean-ptc-v3', {}], ['flash-lean-ptc-v3-balance', {}]]);
  const mounted = [];
  const service = {
    defaultId: 'flash-lean-ptc-v3-lite',
    definitions,
    resolve(id) { const key = id === undefined ? this.defaultId : id; if (!definitions.has(key)) throw notFound(key); return { id: key }; },
    retain(id) { return this.resolve(id); },
    mount(ctx, id) { mounted.push(id); return this.resolve(id); },
    select(agent, id) { mounted.push(id); return this.resolve(id); },
    readDocument(id) { return this.resolve(id); },
  };
  return { service, mounted, definitions };
}

const captured = [];
const realWarn = console.warn;
const realInfo = console.info;
console.warn = (...a) => captured.push(a.join(' '));
console.info = () => {};

const { service, mounted, definitions } = makeService();
const status = installPresetAliases({ effect: () => {} }, service, map, { verbose: true });
assert.equal(status.installed, true);
assert.deepEqual(status.missing, [], '必需入口 resolve/retain 都必须在');
assert.ok(status.methods.includes('readDocument'), 'readDocument 也必须被包装（GUI 查看预设走它）');

// ① 历史 id → canonical（同步返回，不是 Promise）
const r = service.resolve('flash-lean-ptc-v3-lite');
assert.equal(r.id, 'flash-lean-ptc-v3');
assert.equal(typeof r.then, 'undefined', '上游同步，包装后必须仍然同步');

// ② 无参调用：默认 id 本身是历史 id（T1-2）
assert.equal(service.resolve().id, 'flash-lean-ptc-v3');

// ③ 现役 id 原样
assert.equal(service.resolve('flash-lean-ptc-v3-balance').id, 'flash-lean-ptc-v3-balance');

// ④ 用户自己定义的同名预设不许被劫持（T2-2）
definitions.set('flash-lean-ptc-v2', {});
service.mount({}, 'flash-lean-ptc-v2');
assert.equal(mounted.at(-1), 'flash-lean-ptc-v2');

// ⑤ 没定义的历史 id：mount 才换成 canonical
service.mount({}, 'flash-lean');
assert.equal(mounted.at(-1), 'flash-lean-ptc-v3');

// ⑥ 读取类
assert.equal(service.readDocument('flash-lean-ptc-v3-lite').id, 'flash-lean-ptc-v3');

// ⑦ 陌生 id 照常抛错
assert.throws(() => service.resolve('totally-unknown'), (e) => e.code === 'agent-preset/not-found');

// ⑦b 上游 readDocument 的真实形态是「返回被拒绝的 Promise」（Promise.reject，不是同步 throw）：
//     别名层必须走 .catch 分支也照样重试（同步 try/catch 抓不到它）。
{
  const p = makeService();
  p.service.readDocument = (id) => (p.definitions.has(id) ? Promise.resolve({ id })
    : Promise.reject(notFound(id)));
  installPresetAliases({ effect: () => {} }, p.service, map, { verbose: false });
  const doc = await p.service.readDocument('flash-lean-ptc-v3-lite');
  assert.equal(doc.id, 'flash-lean-ptc-v3', 'Promise.reject 形态也要能被别名层救回');
  await assert.rejects(() => p.service.readDocument('totally-unknown'), (e) => e.code === 'agent-preset/not-found');
}

// ⑧ rulesDiffer 警告（flash-lean 命中过一次）
const ruleWarnings = captured.filter((w) => w.includes('规则与'));
assert.ok(ruleWarnings.length >= 1, 'rulesDiffer 的别名必须打印过警告');

await new Promise((resolve) => setTimeout(resolve, 30));
assert.equal(status.selfCheck, 'ok', '自检必须把别名解析到 canonical（T2-1）');

console.warn = realWarn;
console.info = realInfo;
console.log('preset-alias: 9 组断言全部通过（含 Promise.reject 形态）');
