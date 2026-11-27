// fl-bash 组件行（组合包里的 id: fl-bash，name: 'dsh-flash-presets/fl-bash'）。
//
// 为什么单独成行：0.3.4 预览里 Bash 工具是 flash-presets 行下的 flashSh 子功能，插件页上看不到它，
// 用户要去改 flash-presets 那一行的 config.flashSh 才能开。现在它是插件页上单独的一个组件「fl-bash」，
// 标题 / 简介来自 locale/fl-bash/*.json（DSH 按 `<模块名>/locale/en.json` 读子路径的展示元信息）。
//
// 随包发行（0.3.4 起）：fl-bash 的实现与 flash-sh.exe 都在本包里（lib/fl-bash.js、vendor/win32-x64/），
// 由 scripts/sync-fl-bash.mjs 从 plugins/flash-sh/ 逐字节同步（单一来源）。从 npm 装好 dsh-flash-presets
// 就能在插件页打开 fl-bash，不需要另装包。exe 约 7.9 MB，所有平台都会下载；只在 Windows x64 上注册工具，
// 其他平台这一行照常运行、只写一行 info。
//
// 默认开（0.3.4 发版前改：随包发行、装好即用）；开关 DSH_FL_BASH=0/1（旧名 DSH_FLASH_SH 仍认）＞ config.enabled ＞ 默认 true。
// 单独安装的 fl-bash 包自己仍默认关（它的 Config 默认值不动），本行导出的 Config 把 enabled 的默认值改成 true。
// 与单独安装的 fl-bash（行 id fl-bash-standalone）同时启用时，由 fl-bash 的进程级协调器保证只注册一个（本行优先）。
// 旧写法的覆盖（flash-presets 行的 config.flashSh、预览版的行 id flash-sh）读回并叠加到本行，启动日志提示改写。
import { collectRowOverrides, deepMerge, readUserPatches } from './row-overrides.js';

const TAG = '[fl-bash]';
export const ROW_ID = 'fl-bash';
export const FL_BASH_PACKAGE = './fl-bash.js';
export const ROW_DEFAULTS = Object.freeze({ enabled: true });

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
 * 独立行在得到答复前不注册，避免两包同开时启动阶段的短暂双注册。直接写同一个全局对象（与 fl-bash 自己的 setPresetsIntent 等价）。
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

// 插件页的设置表单与 --dump-config-schema 读行模块导出的 Config。本行的设置就是 fl-bash 的设置，所以原样转出它的 Config（单一来源）。
// 只 import 模块本身：fl-bash 加载时没有副作用（不注册工具、不起进程、不清理临时目录），真正启用仍在 apply 里判断。
// 万一加载失败（文件缺失），不导出 Config，apply 里会写一行说明。
let importedConfig;
try {
  const m = await import(FL_BASH_PACKAGE);
  const mod = m.default !== undefined && m.Config === undefined ? m.default : m;
  if (mod && mod.Config) importedConfig = mod.Config;
} catch (error) {
  importedConfig = undefined;
}
export const ROW_ENABLED_DESCRIPTION = '总开关（本组件默认开；只在 Windows x64 上注册工具）；也可用环境变量 DSH_FL_BASH=1 / 0 覆盖（旧名 DSH_FLASH_SH 仍认）';

/** 缺 enabled（未写或 null）时补上本行的默认值 true；其余原样交给 fl-bash 的校验。 */
export function withRowDefault(input) {
  if (input === undefined || input === null) return { enabled: ROW_DEFAULTS.enabled };
  if (!isObj(input)) return input;
  return input.enabled === undefined || input.enabled === null ? { ...input, enabled: ROW_DEFAULTS.enabled } : input;
}

// 插件页的设置表单 / cordis 校验会按 schema 补默认值：fl-bash 自己的 schema 里 enabled 默认 false，
// 用户只改了别的设置（整段替换 config）时就会被补成关。所以本行导出一份 enabled 默认 true 的 Config：
// schemastery 版换掉 enabled 这一项（其余字段原样），手写 Standard Schema 版在校验前补默认值。
async function buildRowConfig(base) {
  if (!base) return undefined;
  if (base.type === 'object' && isObj(base.dict) && base.dict.enabled) {
    try {
      const m = await import('@deepseek-ai/schemastery');
      const Schema = m.default ?? m;
      if (typeof Schema.object === 'function') {
        return Schema.object({ ...base.dict, enabled: Schema.boolean().default(ROW_DEFAULTS.enabled).description(ROW_ENABLED_DESCRIPTION) });
      }
    } catch (error) { /* 退回下面的包装 */ }
  }
  const std = base['~standard'];
  if (std && typeof std.validate === 'function') {
    return Object.freeze({ '~standard': Object.freeze({ version: 1, vendor: 'dsh-flash-presets', validate: (input) => std.validate(withRowDefault(input)) }) });
  }
  return base;
}
export const Config = await buildRowConfig(importedConfig);

let loader = () => import(FL_BASH_PACKAGE);
/** 仅测试用：替换 fl-bash 的加载方式。传 undefined 复原。 */
export function _setLoader(fn) { loader = typeof fn === 'function' ? fn : () => import(FL_BASH_PACKAGE); }

/**
 * 要不要加载 fl-bash。纯函数，便于单测。DSH_FL_BASH=0/1 ＞ enabled（只认字面量 true）。
 * 默认值（true）由 effective() 的 ROW_DEFAULTS 与本行的 Config 补上，这里不再补。
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
      say('info', 'fl-bash 已启用，但加载不到 ' + FL_BASH_PACKAGE + '（包里的 lib/fl-bash.js 缺失？重装 dsh-flash-presets）：' + errText(error) + '；跳过。');
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

export default Config === undefined ? { name, inject, apply } : { name, inject, Config, apply };
