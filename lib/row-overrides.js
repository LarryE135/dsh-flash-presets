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
  // feat/flash-sh 预览版（未发 npm，只发过安装包）里 Bash 工具是本包的独立一行 id: flash-sh。
  // 它现在是单独的组件 fl-bash（行 id fl-bash）；这里只负责拣出来，由 lib/fl-bash-row.js 叠加到那一行。
  'flash-sh': { key: 'flashSh', label: 'fl-bash（Windows Bash 工具）' },
});

/**
 * 单独安装的 fl-bash 包自己的行 id（0.1.x 叫 dsh-flash-sh，行 id flash-sh-standalone）。它的覆盖**不换算**：
 * 只要独立包还装着，那一行就仍然存在、覆盖仍然有效；换算过来会让一个开关同时控制两行。这里只把它找出来供 doctor 提示。
 */
export const STANDALONE_FLASH_SH_ROW = 'fl-bash-standalone';
export const STANDALONE_ROW_IDS = Object.freeze(['fl-bash-standalone', 'flash-sh-standalone']);

/** 组合包补丁里新行的默认 config（compose-bundle-patch.mjs 也从这里取，保证两边一致）。 */
export const BUNDLE_DEFAULTS = Object.freeze({
  toolConcurrency: Object.freeze({ enabled: true }),
  alias: Object.freeze({ enabled: true }),
  planMode: Object.freeze({ enabled: true }),
  deliveryGate: Object.freeze({ enabled: false, maxRounds: 2 }),
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
    if (STANDALONE_ROW_IDS.includes(item.id)) {
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
      // 0.3.2 的 plan-mode-ui / flash-presets-alias 插件都不读 config.enabled（写了也不起作用）；
      // 0.3.4 换算后它会真的关掉计划模式 / 别名层。行为照旧换算，但在启动日志里点名（发布前审计 P3-2）。
      if ((spec.key === 'planMode' || spec.key === 'alias') && item.config.enabled === false) {
        note = 'config.enabled: false 在 0.3.2 里不起作用，0.3.4 起会真的关掉「' + spec.label + '」' +
          (spec.key === 'alias' ? '（历史 preset id 的旧会话可能打不开）' : '') + '；不想关就删掉这一项';
      }
    }
    // disabled 最后算：整行关掉 = 该功能关掉，压过同一条目里的 config.enabled
    if (item.disabled === true) { fields.push('disabled'); if (spec.key === 'core') tc.enabled = false; else part.enabled = false; }
    else if (item.disabled === false) { fields.push('disabled:false'); }
    else if (item.disabled !== undefined) {
      // fl-bash 会在本机执行命令：看不懂的 disabled 按「关」处理（失败即关闭）；其余功能维持原样忽略
      const prev = note === undefined ? '' : note + '；';
      if (spec.key === 'flashSh') { part.enabled = false; note = prev + 'disabled 不是字面量布尔值（如 !!js 表达式），无法换算；fl-bash 按关闭处理'; }
      else note = prev + 'disabled 不是字面量布尔值（如 !!js 表达式），无法换算，已忽略这一项';
    }
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
