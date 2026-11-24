// 0.3.4 起本包的四个运行时行（flash-presets-core / plan-mode-ui / flash-presets-alias / delivery-gate）
// 合成一行 flash-presets（lib/bundle.js）。用户以前按旧行 id 写在自己 profile 补丁里的覆盖，
// DSH 会因为「entry not found」直接丢掉（只在 stderr 打一行警告）。这里把它们读回来、
// 换算到新行的 config 上，保证升级后照样生效 —— 不改写用户的任何文件。
//
// 优先级（从高到低）：用户在 id: flash-presets 上写的覆盖 ＞ 旧行 id 的覆盖 ＞ 组合包默认值。
// 环境变量（DSH_FLASH_PRESETS_CONCURRENCY / DSH_FLASH_PRESETS_ALIAS / DSH_DELIVERY_GATE）
// 仍由各功能自己读，优先级高于以上全部，与 0.3.2 相同。
//
// 本文件只有纯函数 + 一个读补丁的薄壳，不 import 任何宿主包，单测直接喂数组即可。

export const ROW_ID = 'flash-presets';

/** 旧行 id → 新行 config 里的哪一段，以及 disabled: true 等价于什么。 */
export const LEGACY_ROWS = Object.freeze({
  'flash-presets-core': { key: 'core', label: 'run_code 优化 A（glob/grep 并发）' },
  'plan-mode-ui': { key: 'planMode', label: '计划模式' },
  'flash-presets-alias': { key: 'alias', label: '历史 preset id 兼容' },
  'delivery-gate': { key: 'deliveryGate', label: '交付门' },
  // feat/flash-sh 预览版（未发 npm，只发过安装包）里 flash_sh 是本包的独立一行 id: flash-sh
  'flash-sh': { key: 'flashSh', label: 'flash_sh（Windows Bash 工具）' },
});

/**
 * 独立包 dsh-flash-sh 的行 id。它的覆盖**不换算**：只要独立包还装着，那一行就仍然存在、覆盖仍然有效；
 * 换算过来会让一个开关同时控制两行。这里只把它找出来，供启动日志 / doctor 提示「卸了独立包要改写到 flashSh」。
 */
export const STANDALONE_FLASH_SH_ROW = 'flash-sh-standalone';

/** 组合包补丁里新行的默认 config（compose-bundle-patch.mjs 也从这里取，保证两边一致）。 */
export const BUNDLE_DEFAULTS = Object.freeze({
  toolConcurrency: Object.freeze({ enabled: true }),
  alias: Object.freeze({ enabled: true }),
  planMode: Object.freeze({ enabled: true }),
  deliveryGate: Object.freeze({ enabled: false, maxRounds: 2 }),
  flashSh: Object.freeze({ enabled: false }),
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 深合并（数组整体替换，与 cordis 补丁对 config 的处理一致）。 */
export function deepMerge(...layers) {
  const out = {};
  for (const layer of layers) {
    if (!isObj(layer)) continue;
    for (const [k, v] of Object.entries(layer)) {
      out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : (isObj(v) ? deepMerge(v) : v);
    }
  }
  return out;
}

/**
 * 把一组补丁（DSH 的 PatchOptions 数组，按层序）里针对旧行 / 新行的覆盖拣出来。
 * 只认「按 id 改已有行」的条目（没有 insert）；insert 进来的同名行不算覆盖。
 * @returns {{ legacy: object, own: object, found: Array<{id:string, fields:string[], note?:string}>, standalone: string[]|null }}
 */
export function collectRowOverrides(patches) {
  const legacy = {};
  let own = {};
  const found = [];
  let standalone = null;
  if (!Array.isArray(patches)) return { legacy, own, found, standalone };
  for (const item of patches) {
    if (!isObj(item) || item.insert !== undefined || typeof item.id !== 'string') continue;
    if (item.id === STANDALONE_FLASH_SH_ROW) {
      standalone = [...(standalone ?? []), ...(isObj(item.config) ? Object.keys(item.config).map((k) => 'config.' + k) : []), ...(item.disabled !== undefined ? ['disabled'] : [])];
      continue;
    }
    if (item.id === ROW_ID) {
      if (isObj(item.config)) own = deepMerge(own, item.config);
      continue;
    }
    const spec = LEGACY_ROWS[item.id];
    if (spec === undefined) continue;
    const fields = [];
    let note;
    const part = {};
    let tc = {};
    if (isObj(item.config)) {
      fields.push(...Object.keys(item.config).map((k) => 'config.' + k));
      // 旧 core 行的 config 形如 { toolConcurrency: {...} }，新行把它放在顶层 toolConcurrency
      if (spec.key === 'core') { if (isObj(item.config.toolConcurrency)) tc = deepMerge(item.config.toolConcurrency); }
      else Object.assign(part, deepMerge(item.config));
    }
    // disabled 最后算：整行关掉 = 该功能关掉，压过同一条目里的 config.enabled
    if (item.disabled === true) { fields.push('disabled'); if (spec.key === 'core') tc.enabled = false; else part.enabled = false; }
    else if (item.disabled === false) { fields.push('disabled:false'); }
    else if (item.disabled !== undefined) { note = 'disabled 不是字面量布尔值（如 !!js 表达式），无法换算，已忽略这一项'; }
    if (fields.length === 0 && note === undefined) continue;
    found.push({ id: item.id, key: spec.key, label: spec.label, fields, ...(note ? { note } : {}) });
    if (spec.key === 'core') {
      if (Object.keys(tc).length) legacy.toolConcurrency = deepMerge(legacy.toolConcurrency, tc);
    } else {
      legacy[spec.key] = deepMerge(legacy[spec.key], part);
    }
  }
  return { legacy, own, found, standalone };
}

/**
 * 新行收到的 config（= 组合包默认 ⊕ 用户在新 id 上的覆盖，DSH 已合好）＋ 旧行覆盖 → 生效配置。
 * own 再叠一次，保证「用户在新 id 上写的」压过旧 id。
 */
export function effectiveConfig(received, collected) {
  const c = collected || { legacy: {}, own: {} };
  return deepMerge(BUNDLE_DEFAULTS, received, c.legacy, c.own);
}

/**
 * 读当前 profile 的用户层补丁（与 DSH 的 readProfilePatches 同序：profile 补丁、$DSH_HOME 补丁、--patch 叠加层），
 * 不含组合包层。读不了就返回 { ok:false, reason }，由调用方打日志 —— 绝不静默。
 */
export async function readUserPatches(ctx) {
  let profile;
  try { profile = typeof ctx.get === 'function' ? ctx.get('profileContext') : undefined; } catch (error) { profile = undefined; }
  if (!isObj(profile)) return { ok: false, reason: 'no-profile-context', patches: [] };
  let boot;
  try { boot = await import('@deepseek-ai/dsh-app-boot'); } catch (error) {
    return { ok: false, reason: 'app-boot-unavailable: ' + String((error && error.message) || error), patches: [] };
  }
  if (typeof boot.loadOptionalPatches !== 'function') return { ok: false, reason: 'loadOptionalPatches-missing', patches: [] };
  const { join } = await import('node:path');
  const patches = [];
  const errors = [];
  const files = [profile.patchPath, typeof profile.home === 'string' ? join(profile.home, 'cordis.patch.yml') : undefined];
  for (const file of files) {
    if (typeof file !== 'string') continue;
    try { patches.push(...(boot.loadOptionalPatches('dsh', file) ?? [])); } catch (error) { errors.push(file + ': ' + String((error && error.message) || error)); }
  }
  if (Array.isArray(profile.overlays)) patches.push(...profile.overlays);
  return { ok: errors.length === 0, reason: errors.join('; ') || undefined, patches };
}
