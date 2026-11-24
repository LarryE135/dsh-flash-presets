// dsh-flash-presets 的单一运行时入口（0.3.4 起；组合包里的一行 id: flash-presets）。
//
// 为什么合成一行：0.3.2 的插件页上本包占 6 个组件（2 个预设 + 4 个运行时行），其中 4 个运行时行
// 标题都是裸模块名（dsh-flash-presets/core、…/alias、…/delivery-gate），用户看不出各管什么。
// 现在 4 个功能挂在同一行下面，各自作为**子插件**启动：
//
//   子插件           需要的宿主服务                  缺了会怎样
//   别名层 alias     agentPresets                    只有它等着，其余照常
//   优化 A core      tools, agents                   只有它等着，其余照常
//   计划模式宿主     webServer, systemPrompt, tools  只有它等着（桌面端没有 webServer）
//   交付门           systemPrompt                    只有它等着
//   flash_sh         tools（由可选依赖 dsh-flash-sh 提供）  默认关；非 Windows x64 / 依赖没装上时只写一行 info 跳过
//
// 本行自己 inject 为空，任何宿主上都能立即进入运行状态；子插件各自按 inject 等待，
// 互不牵连 —— 这正是当初拆成 4 行要解决的问题（第五轮审计 T1-1：webServer 那一行在桌面端 pending，
// 别名层跟着不跑），合成一行后仍然成立。各子模块也是**动态 import**，任何一个文件/依赖
// 加载失败（比如 zod 解析不到）只影响它自己。
//
// flash_sh（0.3.4）：实现只在独立包 dsh-flash-sh 里（单一来源）。本包把它声明为 optionalDependencies，
// 它的 package.json 写了 os:[win32] cpu:[x64]，所以非 Windows x64 上 pnpm / npm 根本不安装、不下载 exe。
// 这里只在「开了 + 平台对」时才动态 import；与单独安装的 dsh-flash-sh 同时启用时由它的进程级协调器保证只注册一次
// （本行优先，独立行让位并写日志）。
//
// 用户以前按旧行 id 写的覆盖由 row-overrides.js 读回并换算（见该文件头注释）。
import { BUNDLE_DEFAULTS, LEGACY_ROWS, ROW_ID, STANDALONE_FLASH_SH_ROW, collectRowOverrides, effectiveConfig, readUserPatches } from './row-overrides.js';

const TAG = '[flash-presets]';

async function load(spec) {
  try { return { mod: await import(spec) }; } catch (error) { return { error }; }
}

// 顶层 await：四个子模块并行加载，失败各记各的
const [aliasM, coreM, planM, gateM] = await Promise.all([
  load('./alias-plugin.js'), load('./core.js'), load('./index.js'), load('./delivery-gate.js'),
]);

function say(level, message) {
  try { console[level](TAG + ' ' + message); } catch (error) {}
}

function errText(error) {
  return String((error && error.message) || error).split('\n')[0];
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 供测试与 doctor 用：最近一次 apply 的结果。 */
let lastState = null;
export function bundleState() { return lastState; }

export const FLASH_SH_PACKAGE = 'dsh-flash-sh';
let flashShLoader = () => import(FLASH_SH_PACKAGE);
/** 仅测试用：替换 dsh-flash-sh 的加载方式（仓库里没有 node_modules/dsh-flash-sh）。传 undefined 复原。 */
export function _setFlashShLoader(fn) { flashShLoader = typeof fn === 'function' ? fn : () => import(FLASH_SH_PACKAGE); }

/**
 * flashSh 子功能要不要加载、加载什么。纯函数，便于单测。
 * 开关语义与 dsh-flash-sh 自己一致：DSH_FLASH_SH=0/1 ＞ flashSh.enabled ＞ 默认 false。
 * @returns {{ load: boolean, state: string, log?: string }}
 */
export function planFlashSh(cfg, env = process.env, platform = process.platform, arch = process.arch) {
  const c = isObj(cfg) ? cfg : {};
  const on = env.DSH_FLASH_SH === '1' ? true : env.DSH_FLASH_SH === '0' ? false : c.enabled === true;
  if (!on) return { load: false, state: 'off' };
  const winx64 = platform === 'win32' && arch === 'x64';
  const devMode = c.allowNonWindows === true || env.DSH_FLASH_SH_ANY_PLATFORM === '1';
  if (!winx64 && !devMode) {
    return { load: false, state: 'skipped: ' + platform + '-' + arch, log: 'flashSh 已启用，但 flash_sh 只在 Windows x64 上可用（本机 ' + platform + '-' + arch + '）；跳过，不加载 dsh-flash-sh。' };
  }
  return { load: true, state: 'loading' };
}

export const name = 'dsh-flash-presets';
export const inject = [];
export { ROW_ID, LEGACY_ROWS, BUNDLE_DEFAULTS };

export async function apply(ctx, config) {
  const received = isObj(config) ? config : {};
  const read = await readUserPatches(ctx);
  const collected = collectRowOverrides(read.patches);
  const eff = effectiveConfig(received, collected);
  const state = { features: {}, legacy: collected.found, patchRead: read.ok ? 'ok' : read.reason };

  if (!read.ok) {
    // 读不了用户补丁 ≠ 没有旧覆盖：说清楚，让人知道去哪儿看
    say('warn', '没能读取 profile 补丁（' + read.reason + '），按旧行 id（' + Object.keys(LEGACY_ROWS).join(' / ') +
      '）写的覆盖这次没有换算；doctor 会单独检查。');
  }
  for (const item of collected.found) {
    say('info', '沿用旧行 ' + item.id + ' 的覆盖（' + item.fields.join(', ') + '）→ 现在作用于「' + item.label + '」。' +
      (item.note ? ' 注意：' + item.note + '。' : '') +
      ' 建议改写到 id: ' + ROW_ID + ' 的 config.' + (item.key === 'core' ? 'toolConcurrency' : item.key) +
      ' 下（DSH 启动时那条 entry "' + item.id + '" not found 警告就是它）。');
  }

  const mount = (key, loaded, enabled, plugin, cfg) => {
    if (loaded.error !== undefined) {
      state.features[key] = 'load-failed: ' + errText(loaded.error);
      say('error', key + ' 模块加载失败（其余功能不受影响）：' + errText(loaded.error));
      return;
    }
    if (!enabled) { state.features[key] = 'off'; return; }
    try {
      ctx.plugin(plugin(loaded.mod), cfg);
      state.features[key] = 'mounted';
    } catch (error) {
      state.features[key] = 'mount-failed: ' + errText(error);
      say('error', key + ' 启动失败（其余功能不受影响）：' + errText(error));
    }
  };

  const { enabled: planOn, ...planCfg } = isObj(eff.planMode) ? eff.planMode : {};
  const { enabled: aliasOn } = isObj(eff.alias) ? eff.alias : {};
  // 顺序与 0.3.2 的行序一致：core → 计划模式 → 别名 → 交付门
  mount('core', coreM, true, (m) => m.default, { toolConcurrency: isObj(eff.toolConcurrency) ? eff.toolConcurrency : {} });
  mount('planMode', planM, planOn !== false, (m) => m.default, planCfg);
  mount('alias', aliasM, aliasOn !== false, (m) => m.default, {});
  // 交付门：总是挂上，由它自己按 enabled / DSH_DELIVERY_GATE 决定做不做事（与 0.3.2 的独立行一致）
  mount('deliveryGate', gateM, true, (m) => m, isObj(eff.deliveryGate) ? eff.deliveryGate : {});

  // flash_sh：只在开了 + 平台对时才加载可选依赖 dsh-flash-sh；任何失败都只写一行 info，不影响其它功能
  const flashCfg = isObj(eff.flashSh) ? eff.flashSh : {};
  const fp = planFlashSh(flashCfg);
  state.features.flashSh = fp.state;
  if (fp.log) say('info', fp.log);
  if (fp.load) {
    let mod;
    try { mod = await flashShLoader(); } catch (error) {
      state.features.flashSh = 'unavailable: ' + errText(error);
      say('info', 'flashSh 已启用，但加载不到 ' + FLASH_SH_PACKAGE + '（可选依赖没装上？只在 Windows x64 上安装；也可以单独安装它）：' + errText(error) + '；跳过。');
    }
    if (mod !== undefined) {
      const m = mod.default !== undefined && typeof mod.createPlugin !== 'function' && typeof mod.default.createPlugin === 'function' ? mod.default : mod;
      if (typeof m.createPlugin === 'function') {
        mount('flashSh', { mod: m }, true, (x) => x.createPlugin({ owner: 'dsh-flash-presets' }), flashCfg);
      } else {
        state.features.flashSh = 'unavailable: ' + FLASH_SH_PACKAGE + ' 版本过旧（没有 createPlugin）';
        say('info', 'flashSh 已启用，但已安装的 ' + FLASH_SH_PACKAGE + ' 版本过旧（没有 createPlugin，需要 ≥0.1.0 的新版）；跳过。');
      }
    }
  }
  if (collected.standalone && fp.state === 'off') {
    say('info', '检测到 profile 补丁里 id: ' + STANDALONE_FLASH_SH_ROW + ' 的覆盖（' + collected.standalone.join(', ') + '）：它属于单独安装的 dsh-flash-sh 那一行，本行不换算。' +
      '如果你已卸载 dsh-flash-sh、想改用这里的 flashSh，请把它改写到 id: ' + ROW_ID + ' 的 config.flashSh 下。');
  }

  if (aliasOn === false) say('warn', '历史 preset id 兼容已关闭（alias.enabled=false）：0.2.6 及更早建的会话可能打不开。');
  lastState = { ...state, effective: eff };
  const f = state.features;
  say('info', '单行组合 ' + ROW_ID + '｜core=' + f.core + ' planMode=' + f.planMode + ' alias=' + f.alias +
    ' deliveryGate=' + f.deliveryGate + (eff.deliveryGate && eff.deliveryGate.enabled === true ? '(启用)' : '(默认关)') +
    ' flashSh=' + f.flashSh +
    '｜旧行覆盖 ' + collected.found.length + ' 处');
}

export default { name, inject, apply };
