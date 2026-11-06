// 历史 preset id 的解析兜底（alias 层）。
//
// 背景：DSH 把 preset id 持久化在会话日志里（首帧 header.agentPreset，以及随后可能出现的
// agent-preset/selected 事件），resume 时用 agentPresets.resolve(id) 解析，解析不到就抛
// agent-preset/not-found —— 会话看起来“打不开”。上游没有任何 alias / hidden / fallback 机制
// （registry 的 definition 只有 id/name/description/order/plugins），所以插件改名或删除 id
// 就等于把旧会话弄丢。
//
// 本文件给出唯一不写用户数据的兜底：在内存里把历史上出现过的 id 映射到当前 id。
//  - 只拦截「解析失败」这一种情况：id 仍然存在时原样走原逻辑，行为不变；
//  - 不做任何会话文件写操作（区别于 0.2.6 的迁移与 0.2.8 的自愈）；
//  - 任一方法不存在 / 签名变化 / 赋值失败 → 静默跳过，绝不抛错，退化成今天的默认行为；
//  - DSH_FLASH_PRESETS_ALIAS=0 可整体关闭。
//
// 映射表：presets/legacy-preset-map.json（可增删，不需要动代码）。
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MARK = Symbol.for('dsh-flash-presets.preset-alias');
const NOT_FOUND = 'agent-preset/not-found';

function packageRoot() {
  // lib/ 与 presets/ 同级（包根）
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

export function loadAliasMap() {
  const file = join(packageRoot(), 'presets', 'legacy-preset-map.json');
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed === null || typeof parsed !== 'object') return null;
    const aliases = parsed.aliases;
    const canonical = parsed.canonical;
    if (aliases === null || typeof aliases !== 'object' || typeof canonical !== 'string' || canonical === '') return null;
    const clean = {};
    // `$comment` 一类元数据键不是 id（第三轮审计 R2-5：CHANGELOG 早就这么写了，代码里却没有）。
    for (const key of Object.keys(aliases)) { if (key !== canonical && !key.startsWith('$')) clean[key] = canonical; }
    // 个人实验 id 不进发布物：用 DSH_FLASH_PRESETS_ALIAS_EXTRA 指向自己的 JSON（{"aliases":{id:{...}}}）。
    const extra = process.env.DSH_FLASH_PRESETS_ALIAS_EXTRA;
    if (typeof extra === 'string' && extra !== '' && existsSync(extra)) {
      try {
        const local = JSON.parse(readFileSync(extra, 'utf8'));
        const map = local && typeof local === 'object' ? local.aliases || local : null;
        if (map && typeof map === 'object') {
          for (const key of Object.keys(map)) { if (key !== canonical && !key.startsWith('$') && !(key in clean)) clean[key] = canonical; }
        }
      } catch (error) {
        try { console.warn('[preset-alias] 外部映射文件解析失败，已忽略：' + extra); } catch (e) {}
      }
    }
    return { canonical, aliases: clean };
  } catch { return null; }
}

function isNotFound(error) {
  if (error === null || error === undefined) return false;
  try {
    if (error.code === NOT_FOUND) return true;
    const message = typeof error.message === 'string' ? error.message : '';
    return message.indexOf(NOT_FOUND) !== -1 || message.indexOf('Unknown agent preset') !== -1;
  } catch { return false; }
}

/**
 * 在 agentPresets 服务上挂 alias 兜底。
 * @returns {{installed: boolean, reason?: string, aliases: number}}
 */
export function installPresetAliases(ctx, service, map, options) {
  const verbose = options === undefined || options.verbose !== false;
  if (service === null || typeof service !== 'object') return { installed: false, reason: 'service-missing', aliases: 0 };
  try { if (service[MARK] === true) return { installed: false, reason: 'already-installed', aliases: 0 }; } catch (e) {}
  const aliasOf = (id) => {
    if (typeof id !== 'string') return id;
    return Object.prototype.hasOwnProperty.call(map.aliases, id) ? map.canonical : id;
  };
  const noted = new Set();
  const note = (from, to) => {
    if (!verbose || noted.has(from)) return;
    noted.add(from);
    try { console.info('[preset-alias] ' + from + ' -> ' + to + '（旧会话继续可用）'); } catch (e) {}
  };
  const restored = [];
  const patch = (name, build) => {
    let original;
    try { original = service[name]; } catch (e) { return; }
    if (typeof original !== 'function') return;
    try { if (original[MARK] === true) return; } catch (e) {}
    let replacement;
    try { replacement = build(original); } catch (e) { return; }
    if (typeof replacement !== 'function') return;
    try { replacement[MARK] = true; } catch (e) {}
    try { service[name] = replacement; } catch (e) { return; }
    restored.push([name, original]);
  };
  // 解析类：先按原 id 解析；只有 not-found 才用 canonical 重试一次。
  for (const name of ['resolve', 'retain', 'acquireScope']) {
    patch(name, (original) => async function (...args) {
      const wanted = args[0];
      const target = aliasOf(wanted);
      try {
        return await original.apply(this, args);
      } catch (error) {
        if (target === wanted || !isNotFound(error)) throw error;
        const retried = args.slice();
        retried[0] = target;
        const result = await original.apply(this, retried);
        note(wanted, target);
        return result;
      }
    });
  }
  // 装载类：id 在第 2 个参数（mount(ctx, id) / select(agent, id)），进门前就换成 canonical。
  for (const name of ['mount', 'select']) {
    patch(name, (original) => function (...args) {
      if (args.length > 1) {
        const target = aliasOf(args[1]);
        if (target !== args[1]) { note(args[1], target); args[1] = target; }
      }
      return original.apply(this, args);
    });
  }
  if (restored.length === 0) return { installed: false, reason: 'no-methods', aliases: Object.keys(map.aliases).length };
  try { Object.defineProperty(service, MARK, { value: true, enumerable: false, configurable: true }); } catch (e) {}
  if (typeof ctx.effect === 'function') {
    try {
      ctx.effect(() => () => {
        for (const [name, original] of restored) { try { service[name] = original; } catch (e) {} }
        try { delete service[MARK]; } catch (e) {}
      }, 'preset-alias');
    } catch (e) {}
  }
  return { installed: true, aliases: Object.keys(map.aliases).length, methods: restored.map(([n]) => n) };
}

/** 等 agentPresets 服务就绪后挂上 alias 层；任何异常都只记一条日志。 */
export function schedulePresetAliases(ctx, options) {
  if (process.env.DSH_FLASH_PRESETS_ALIAS === '0') {
    try { console.info('[preset-alias] 已按 DSH_FLASH_PRESETS_ALIAS=0 关闭'); } catch (e) {}
    return;
  }
  const map = loadAliasMap();
  if (map === null) {
    try { console.info('[preset-alias] 未找到 presets/legacy-preset-map.json，跳过'); } catch (e) {}
    return;
  }
  const run = (child) => {
    try {
      const service = child.agentPresets !== undefined ? child.agentPresets : child.get('agentPresets');
      const result = installPresetAliases(child, service, map, options);
      if (result.installed) {
        try { console.info('[preset-alias] 已启用 ' + result.aliases + ' 个历史 preset id 的解析兜底（' + result.methods.join('/') + '）'); } catch (e) {}
      } else {
        try { console.info('[preset-alias] 未启用：' + result.reason); } catch (e) {}
      }
    } catch (error) {
      try { console.error('[preset-alias] 安装失败（已忽略）:', error); } catch (e) {}
    }
  };
  try {
    ctx.inject(['agentPresets'], run);
  } catch (error) {
    try { console.error('[preset-alias] inject 失败（已忽略）:', error); } catch (e) {}
  }
}
