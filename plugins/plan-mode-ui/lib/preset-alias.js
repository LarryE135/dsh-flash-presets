// 历史 preset id 的解析兜底（alias 层）。
//
// 背景：DSH 把 preset id 持久化在会话日志里（首帧 header.agentPreset，以及随后可能出现的
// agent-preset/selected 事件），resume 时用 agentPresets.resolve(id) 解析，解析不到就抛
// agent-preset/not-found —— 会话看起来“打不开”。上游没有任何 alias / hidden / fallback 机制
// （registry 的 definition 只有 id/name/description/order/plugins），所以插件改名或删除 id
// 就等于把旧会话弄丢。
//
// 本文件给出唯一不写用户数据的兜底：在内存里把历史上出现过的 id 映射到当前 id。
//  - 只拦截「解析失败」这一种情况：id 仍然存在时原样走原逻辑（mount/select 会先确认 id 是否
//    真的有定义，第五轮审计 T2-2：以前是「进了门就换」，会把用户自己定义的同名预设劫持掉）；
//  - 不做任何会话文件写操作；
//  - 规则与 canonical 不同的别名（rulesDiffer）在首次命中时打印警告：打得开优先，但规则变化必须可见；
//  - 任一必需入口（resolve / retain）缺失、自检失败 → 大声 warn，绝不静默；
//  - DSH_FLASH_PRESETS_ALIAS=0 可整体关闭。
//
// 挂载方式：lib/alias-plugin.js（只 inject ['agentPresets']）。**不要再挂到 plan-mode-ui 上** ——
// 那一行 inject 了 webServer，桌面端（Electron）会停在 pending，别名层就不存在了（第五轮审计 T1-1）。
//
// 映射表：presets/legacy-preset-map.json（可增删，不需要动代码）。
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MARK = Symbol.for('dsh-flash-presets.preset-alias');
const STATUS = Symbol.for('dsh-flash-presets.alias-status');
const NOT_FOUND = 'agent-preset/not-found';
const REQUIRED = ['resolve', 'retain'];

function packageRoots() {
  // 装成包时 lib/ 与 presets/ 同级（包根）；在仓库里跑（plugins/plan-mode-ui/lib/）时要往上两层。
  const here = dirname(fileURLToPath(import.meta.url));
  return [join(here, '..'), join(here, '..', '..', '..')];
}

/** 把别名表的条目归一成 { rulesDiffer, since, note }；兼容旧的字符串写法。 */
function normalizeEntry(value) {
  if (typeof value === 'string') return { rulesDiffer: false, since: value, note: '' };
  if (value === null || typeof value !== 'object') return { rulesDiffer: false, since: '', note: '' };
  return {
    rulesDiffer: value.rulesDiffer === true,
    since: typeof value.since === 'string' ? value.since : '',
    note: typeof value.note === 'string' ? value.note : '',
  };
}

export function loadAliasMap() {
  let file = null;
  for (const root of packageRoots()) {
    const candidate = join(root, 'presets', 'legacy-preset-map.json');
    if (existsSync(candidate)) { file = candidate; break; }
  }
  if (file === null) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed === null || typeof parsed !== 'object') return null;
    const aliases = parsed.aliases;
    const canonical = parsed.canonical;
    if (aliases === null || typeof aliases !== 'object' || typeof canonical !== 'string' || canonical === '') return null;
    const clean = {};
    // `$comment` 一类元数据键不是 id（第三轮审计 R2-5：CHANGELOG 早就这么写了，代码里却没有）。
    for (const key of Object.keys(aliases)) {
      if (key === canonical || key.startsWith('$')) continue;
      clean[key] = normalizeEntry(aliases[key]);
    }
    // 个人实验 id 不进发布物：用 DSH_FLASH_PRESETS_ALIAS_EXTRA 指向自己的 JSON（{"aliases":{id:{...}}}）。
    const extra = process.env.DSH_FLASH_PRESETS_ALIAS_EXTRA;
    if (typeof extra === 'string' && extra !== '' && existsSync(extra)) {
      try {
        const local = JSON.parse(readFileSync(extra, 'utf8'));
        const map = local && typeof local === 'object' ? local.aliases || local : null;
        if (map && typeof map === 'object') {
          for (const key of Object.keys(map)) {
            if (key === canonical || key.startsWith('$') || key in clean) continue;
            clean[key] = normalizeEntry(map[key]);
          }
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

function idOf(value) {
  if (value === null || typeof value !== 'object') return undefined;
  if (typeof value.id === 'string') return value.id;
  if (value.config !== null && typeof value.config === 'object' && typeof value.config.id === 'string') return value.config.id;
  if (value.definition !== null && typeof value.definition === 'object' && typeof value.definition.id === 'string') return value.definition.id;
  return undefined;
}

/**
 * 在 agentPresets 服务上挂 alias 兜底。
 * @returns {{installed: boolean, reason?: string, aliases: number, methods?: string[], missing?: string[], selfCheck?: string}}
 */
export function installPresetAliases(ctx, service, map, options) {
  const verbose = options === undefined || options.verbose !== false;
  if (service === null || typeof service !== 'object') return { installed: false, reason: 'service-missing', aliases: 0 };
  try { if (service[MARK] === true) return { installed: false, reason: 'already-installed', aliases: 0 }; } catch (e) {}
  const has = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(map.aliases, id);
  const aliasOf = (id) => (has(id) ? map.canonical : id);
  // 上游可能把默认 id 放在 service.defaultId（resolve(id ?? defaultId)）—— 第五轮审计 T1-2：
  // 新建会话时 args[0] 是 undefined，不补这一层就等于「默认预设是旧 id 的人连新会话都建不了」。
  const defaultId = () => {
    try { const d = service.defaultId; return typeof d === 'string' && d !== '' ? d : undefined; } catch (e) { return undefined; }
  };
  const wantedOf = (args) => (typeof args[0] === 'string' && args[0] !== '' ? args[0] : defaultId());
  let baseResolve = null;
  try { baseResolve = typeof service.resolve === 'function' ? service.resolve : null; } catch (e) { baseResolve = null; }

  const noted = new Set();
  const warned = new Set();
  // 自检的探测请求不该产生日志：全新装、没有任何旧会话时也不该打「旧会话继续可用」（第六轮 U3-1）。
  let silent = false;
  const note = (from, to) => {
    // 规则差异警告与 verbose 无关：打得开是默认，但「规则变了」必须可见（第五轮审计 T0-2）。
    if (!warned.has(from)) {
      const entryW = map.aliases[from];
      if (entryW !== undefined && entryW.rulesDiffer === true) {
        warned.add(from);
        try {
          // 措辞不能再让人「加回那一行」（第七轮审计 A7）：v1/v2 是 0.2.5 时代的卡，那几行在 DSH 0.2.2 上
          // 本身就加载不了，加回去不生效。给两条真能走的路，并把这条的历史参数写出来。
          const why = entryW && typeof entryW.note === 'string' && entryW.note ? '（原规则：' + entryW.note + '）' : '';
          console.warn('[preset-alias] 注意：' + from + ' 的规则与 ' + to + ' 不同' + why + '，该会话现在按 ' + to + ' 的规则运行；'
            + '要保留原规则只有两条路：① 继续用 0.2.8 或更早的版本打开这段对话；'
            + '② 照上面的参数用当前语法自建一条同规则的预设（v1/v2 的原始行在 DSH 0.2.2 上本身就加载不了，照抄一遍也不生效）。');
        } catch (e) {}
      }
    }
    if (silent || !verbose || noted.has(from)) return;  // silent：自检的探测请求不打 info，rulesDiffer 警告照打
    noted.add(from);
    try { console.info('[preset-alias] ' + from + ' -> ' + to + '（旧会话继续可用）'); } catch (e) {}
  };
  const restored = [];
  const patch = (name, build) => {
    let original;
    try { original = service[name]; } catch (e) { return false; }
    if (typeof original !== 'function') return false;
    try { if (original[MARK] === true) return false; } catch (e) {}
    let replacement;
    try { replacement = build(original); } catch (e) { return false; }
    if (typeof replacement !== 'function') return false;
    try { replacement[MARK] = true; } catch (e) {}
    try { service[name] = replacement; } catch (e) { return false; }
    restored.push([name, original]);
    return true;
  };
  // 存在性判定：优先用 registry 的 definitions（同步、零成本）；拿不到才退回「用未打补丁的 resolve 试一次」，
  // 那种情况下**必须保持上游的同步/异步形态**——上游 resolve 是同步的话，返回 Promise 会把调用方全打坏。
  const isDefinedSync = (id) => {
    try {
      const defs = service.definitions;
      if (defs && typeof defs.has === 'function') return defs.has(id) === true;
    } catch (e) {}
    return undefined;
  };
  const isPromise = (v) => v !== null && typeof v === 'object' && typeof v.then === 'function';
  // 「先按原 id 调，只有 not-found 才用 canonical 重试」：同步走同步、异步走异步，绝不改变返回形态。
  const wrapRetry = (original, kind) => function (...args) {
    const wanted = kind === 'id2' ? (args.length > 1 ? args[1] : undefined) : wantedOf(args);
    const target = aliasOf(wanted);
    const retriedArgs = () => { const a = args.slice(); a[kind === 'id2' ? 1 : 0] = target; return a; };
    const retry = () => { note(wanted, target); return original.apply(this, retriedArgs()); };
    const canRetry = target !== wanted && target !== undefined;
    let result;
    try {
      result = original.apply(this, args);
    } catch (error) {
      if (!canRetry || !isNotFound(error)) throw error;
      return retry();
    }
    if (!canRetry || !isPromise(result)) return result;
    return result.catch((error) => {
      if (!isNotFound(error)) throw error;
      return retry();
    });
  };
  // 装载类：id 在第 2 个参数（mount(ctx, id) / select(agent, id)）。**只在 id 真的没定义时**才换成
  // canonical —— 用户自己定义的同名预设不能被劫持（第五轮审计 T2-2）。
  const wrapMount = (original) => function (...args) {
    const id = args.length > 1 ? args[1] : undefined;
    if (!has(id)) return original.apply(this, args);
    const fix = () => { args[1] = map.canonical; note(id, map.canonical); };
    const known = isDefinedSync(id);
    if (known === true) return original.apply(this, args);
    if (known === false) { fix(); return original.apply(this, args); }
    // definitions 拿不到：用未打补丁的 resolve 探一次，形态与原函数保持一致
    if (baseResolve === null) return original.apply(this, args);   // 无从判定 → 不乱动
    let probe;
    try { probe = baseResolve.call(service, id); } catch (error) { if (isNotFound(error)) fix(); return original.apply(this, args); }
    if (isPromise(probe)) {
      return probe.then(() => original.apply(this, args),
        (error) => { if (isNotFound(error)) fix(); return original.apply(this, args); });
    }
    return original.apply(this, args);
  };
  for (const name of ['resolve', 'retain', 'acquireScope']) {
    patch(name, (original) => wrapRetry(original, 'id1'));
  }
  // 读取类：GUI「查看预设」走的是 read / readDocument（第五轮审计 T3-2）。
  for (const name of ['readDocument', 'read']) {
    patch(name, (original) => wrapRetry(original, 'id1'));
  }
  for (const name of ['mount', 'select']) {
    patch(name, (original) => wrapMount(original));
  }
  const methods = restored.map(([n]) => n);
  const missing = REQUIRED.filter((name) => !methods.includes(name));
  const status = { installed: restored.length > 0, aliases: Object.keys(map.aliases).length, methods, missing, selfCheck: 'pending' };
  if (missing.length > 0) {
    try {
      console.warn('[preset-alias] 缺少必需入口 ' + missing.join(' / ') + '（上游可能改了方法名）：旧会话将打不开，请升级插件');
    } catch (e) {}
  }
  if (restored.length === 0) {
    status.reason = 'no-methods';
    try { console.info('[preset-alias] 未启用：no-methods'); } catch (e) {}
    return status;
  }
  try { Object.defineProperty(service, MARK, { value: true, enumerable: false, configurable: true }); } catch (e) {}
  try { Object.defineProperty(service, STATUS, { value: status, enumerable: false, configurable: true }); } catch (e) {}
  // 自检（第五轮审计 T2-1）：装完立刻用**打过补丁的** resolve 解一次别名，解不出 canonical 就大声报。
  // 探测固定挑「规则相同」的别名：排序一变就不该在每次启动时打假的「规则不同」警告。
  const probe = Object.keys(map.aliases).find((k) => map.aliases[k] && map.aliases[k].rulesDiffer === false)
    ?? Object.keys(map.aliases)[0];
  silent = true;
  if (probe !== undefined && typeof service.resolve === 'function') {
    Promise.resolve().then(() => service.resolve(probe)).then((result) => {
      silent = false;
      const got = idOf(result);
      if (got === map.canonical) { status.selfCheck = 'ok'; return; }
      status.selfCheck = 'mismatch';
      try { console.warn('[preset-alias] 自检失败：resolve("' + probe + '") 返回 ' + String(got) + '，不是 ' + map.canonical + ' —— 旧会话可能打不开'); } catch (e) {}
    }).catch((error) => {
      silent = false;
      status.selfCheck = 'failed';
      try { console.warn('[preset-alias] 自检失败：resolve("' + probe + '") 抛错（' + String(error && error.message ? error.message : error) + '）—— 旧会话将打不开'); } catch (e) {}
    });
  }
  if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') {
    try {
      ctx.effect(() => () => {
        for (const [name, original] of restored) { try { service[name] = original; } catch (e) {} }
        try { delete service[MARK]; } catch (e) {}
      }, 'preset-alias');
    } catch (e) {}
  }
  status.installed = true;
  return status;
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
      } else if (result.reason !== 'already-installed') {
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
