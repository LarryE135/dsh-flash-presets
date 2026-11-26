// fl-bash 组件行（组合包里的 id: fl-bash，name: 'dsh-flash-presets/fl-bash'）。
//
// 为什么单独成行：0.3.4 预览里 Bash 工具是 flash-presets 行下的 flashSh 子功能，插件页上看不到它，
// 用户要去改 flash-presets 那一行的 config.flashSh 才能开。现在它是插件页上单独的一个组件「fl-bash」，
// 标题 / 简介来自 locale/fl-bash/*.json（DSH 按 `<模块名>/locale/en.json` 读子路径的展示元信息）。
//
// 为什么行的模块是本包的子路径、而不是直接写 name: 'fl-bash'：
//   · fl-bash 是本包的可选依赖，声明了 os:[win32] cpu:[x64]，非 Windows x64 上根本不安装；
//     直接写 'fl-bash' 的行在这些平台上会变成「加载失败」的红行。本模块在任何平台都能加载，
//     平台不对 / 依赖缺失只写一行 info。
//   · 在 pnpm 的 profile 里，只有本包（直接依赖）能解析到它的可选依赖 fl-bash；从 profile 根解析会失败。
//
// 行为与 0.3.4 预览里的 flashSh 子功能一致：默认关；开关 DSH_FL_BASH=0/1（旧名 DSH_FLASH_SH 仍认）＞ config.enabled；
// 与单独安装的 fl-bash（行 id fl-bash-standalone）同时启用时，由 fl-bash 的进程级协调器保证只注册一个（本行优先）。
// 旧写法的覆盖（flash-presets 行的 config.flashSh、预览版的行 id flash-sh）读回并叠加到本行，启动日志提示改写。
import { collectRowOverrides, deepMerge, readUserPatches } from './row-overrides.js';

const TAG = '[fl-bash]';
export const ROW_ID = 'fl-bash';
export const FL_BASH_PACKAGE = 'fl-bash';
export const ROW_DEFAULTS = Object.freeze({ enabled: false });

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function say(level, message) { try { console[level](TAG + ' ' + message); } catch (error) {} }
function errText(error) { return String((error && error.message) || error).split('\n')[0]; }

/** 读环境变量：新名优先，旧名（DSH_FLASH_SH*）兼容。 */
export function envFlag(env, suffix = '') {
  const v = env['DSH_FL_BASH' + suffix];
  return v !== undefined && v !== '' ? v : env['DSH_FLASH_SH' + suffix];
}

/**
 * 告诉 fl-bash 的独立行「本行会不会提供 fl_bash」（协议见 fl-bash lib/index.js 的 PRESETS_INTENT_KEY）。
 * 独立行在得到答复前不注册，避免两包同开时启动阶段的短暂双注册。本包不能静态 import 可选依赖，所以直接写同一个全局对象。
 * pending（开始 apply）→ loading（决定挂上，claim 稍后由 fl-bash 自己登记）/ none（不提供）。
 * 全局键名沿用 0.1.x 的 Symbol（进程内协议，不对用户可见），新旧两版 fl-bash / dsh-flash-sh 都认。
 */
export const INTENT_KEY = Symbol.for('dsh-flash-sh/presets-intent@1');
export function setIntent(state) {
  let o = globalThis[INTENT_KEY];
  if (!o || typeof o !== 'object' || !(o.listeners instanceof Set)) {
    o = { state: undefined, at: undefined, listeners: new Set() };
    globalThis[INTENT_KEY] = o;
  }
  o.state = state;
  o.at = Date.now();
  for (const fn of [...o.listeners]) { try { fn(state); } catch (error) {} }
}

let loader = () => import(FL_BASH_PACKAGE);
/** 仅测试用：替换 fl-bash 的加载方式（仓库里没有 node_modules/fl-bash）。传 undefined 复原。 */
export function _setLoader(fn) { loader = typeof fn === 'function' ? fn : () => import(FL_BASH_PACKAGE); }

/**
 * 要不要加载 fl-bash。纯函数，便于单测。开关语义与 fl-bash 自己一致：DSH_FL_BASH=0/1 ＞ enabled ＞ 默认 false。
 * @returns {{ load: boolean, state: string, log?: string }}
 */
export function plan(cfg, env = process.env, platform = process.platform, arch = process.arch) {
  const c = isObj(cfg) ? cfg : {};
  const flag = envFlag(env);
  const on = flag === '1' ? true : flag === '0' ? false : c.enabled === true;
  if (!on) return { load: false, state: 'off' };
  const winx64 = platform === 'win32' && arch === 'x64';
  const devMode = c.allowNonWindows === true || envFlag(env, '_ANY_PLATFORM') === '1';
  if (!winx64 && !devMode) {
    return { load: false, state: 'skipped: ' + platform + '-' + arch, log: 'fl-bash 已启用，但 fl_bash 只在 Windows x64 上可用（本机 ' + platform + '-' + arch + '）；跳过，不加载 fl-bash。' };
  }
  return { load: true, state: 'loading' };
}

/** 用 fl-bash 导出的 Config（Standard Schema v1）校验；校验器缺失 / 异步 / 抛错时不拦（交给 cordis）。 */
export function validate(m, cfg) {
  try {
    const std = m && m.Config && m.Config['~standard'];
    if (!std || typeof std.validate !== 'function') return [];
    const r = std.validate(cfg);
    if (!r || typeof r.then === 'function' || !Array.isArray(r.issues)) return [];
    return r.issues.map((i) => String((i && i.message) || i));
  } catch (error) {
    return [];
  }
}

/**
 * 旧写法 → 本行。优先级（高→低）：用户在 id: fl-bash 上写的 ＞ flash-presets 行的 config.flashSh ＞ 预览版行 id flash-sh ＞ 默认。
 * received 是 DSH 交给本行的 config（= 组合包默认 ⊕ 用户在 id: fl-bash 上的覆盖，整段替换语义）。
 * @returns {{ cfg: object, found: string[] }}
 */
export function effective(received, patches) {
  const found = [];
  let legacy = {};
  let own;
  if (Array.isArray(patches)) {
    const c = collectRowOverrides(patches);
    if (isObj(c.legacy.flashSh)) { legacy = deepMerge(legacy, c.legacy.flashSh); found.push(...c.found.filter((x) => x.key === 'flashSh').map((x) => x.id + '（' + x.fields.join(', ') + '）')); }
    if (isObj(c.own.flashSh)) { legacy = deepMerge(legacy, c.own.flashSh); found.push('flash-presets 的 config.flashSh（' + Object.keys(c.own.flashSh).join(', ') + '）'); }
    for (const item of patches) {
      if (isObj(item) && item.insert === undefined && item.id === ROW_ID && isObj(item.config)) own = deepMerge(own, item.config);
    }
  }
  // 用户在新行上写过就以它为准（整段替换，与 DSH 对 config 的处理一致）；否则默认 ⊕ 旧写法
  const cfg = own !== undefined ? deepMerge(ROW_DEFAULTS, received) : deepMerge(ROW_DEFAULTS, received, legacy);
  return { cfg, found };
}

let lastState = null;
export function rowState() { return lastState; }

export const name = 'dsh-flash-presets/fl-bash';
export const inject = [];

export async function apply(ctx, config) {
  // 第一件事（在任何 await 之前）：表态「还没决定」，让同时启用的独立行先等一等
  setIntent('pending');
  try { if (typeof ctx.effect === 'function') ctx.effect(() => () => setIntent('none'), 'fl-bash intent'); } catch (error) {}
  const received = isObj(config) ? config : {};
  const read = await readUserPatches(ctx);
  if (!read.ok) say('info', '没能读取 profile 补丁（' + read.reason + '），旧写法（flash-presets 的 config.flashSh / 行 id flash-sh）这次没有换算。');
  const { cfg, found } = effective(received, read.patches);
  for (const f of found) say('info', '沿用旧写法 ' + f + ' → 现在作用于 fl-bash 组件。建议改写到 id: ' + ROW_ID + ' 的 config 下。');
  const st = { state: 'off', legacy: found };
  const p = plan(cfg);
  st.state = p.state;
  if (p.log) say('info', p.log);
  if (p.load) {
    let mod;
    try { mod = await loader(); } catch (error) {
      st.state = 'unavailable: ' + errText(error);
      say('info', 'fl-bash 已启用，但加载不到 ' + FL_BASH_PACKAGE + '（可选依赖只在 Windows x64 上安装；也可以单独安装它）：' + errText(error) + '；跳过。');
    }
    if (mod !== undefined) {
      const m = mod.default !== undefined && typeof mod.createPlugin !== 'function' && typeof mod.default.createPlugin === 'function' ? mod.default : mod;
      if (typeof m.createPlugin !== 'function') {
        st.state = 'unavailable: ' + FL_BASH_PACKAGE + ' 版本过旧（没有 createPlugin）';
        say('info', 'fl-bash 已启用，但已安装的版本过旧（没有 createPlugin）；跳过。');
      } else {
        // 先按 fl-bash 自己的 Config 校验：cordis 遇到非法配置时只记一行错误、不调 apply，
        // 不先校验就会谎报 mounted，而 fl_bash 其实不存在（独立行还会白等）
        const issues = validate(m, cfg);
        if (issues.length) {
          st.state = 'config-invalid: ' + issues.join('; ');
          say('warn', 'fl-bash 配置不合法，没有启用：' + issues.join('; ') + '。请改 id: ' + ROW_ID + ' 的 config。');
        } else {
          setIntent('loading');
          try {
            ctx.plugin(m.createPlugin({ owner: 'dsh-flash-presets' }), cfg);
            st.state = 'mounted';
          } catch (error) {
            st.state = 'mount-failed: ' + errText(error);
            say('error', 'fl-bash 启动失败：' + errText(error));
          }
        }
      }
    }
  }
  if (st.state !== 'mounted') setIntent('none');
  lastState = { ...st, effective: cfg };
  say('info', '组件 ' + ROW_ID + '｜' + st.state + (found.length ? '｜旧写法 ' + found.length + ' 处' : ''));
}

export default { name, inject, apply };
