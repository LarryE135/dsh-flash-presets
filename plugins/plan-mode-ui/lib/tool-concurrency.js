/**
 * 给 glob/grep 补“只读并发安全”标记，让原生多调用能真正并行（run_code 优化 A）。
 *
 * 为什么要补：上游 dsh-tool-fs-search 至今没有在 defineTool 里声明 isConcurrencySafe，
 * 而 dsh-tools 的调度器只认 === true（pipeline.js: executionMode()）——未声明、隐藏、
 * 抛错一律按 exclusive 串行；tools.register() 又不允许同名覆盖
 * （"tool \"glob\" is already registered"）。所以唯一不碰 node_modules 的办法是
 * 在**已注册的定义对象**上补一个分类函数：defineTool 返回的是普通可变对象，registry
 * 与调度器持有同一引用。
 *
 * 作用域：预设组合是**按 agent 挂载**的，工具定义因此也是每个 agent 一份
 * （tools.get(name, agent)）。所以除了全局视图，还要扫已挂载 agent；新 agent 由
 * 定时扫描补上（默认 15s，可调）。
 *
 * 历史：0.2.x 早期用 scripts/tune-runtime.mjs 改 profile 里的
 * node_modules/@deepseek-ai/dsh-tool-fs-search/lib/index.js。0.2.2-rc.1 起该包不再是
 * profile 依赖（从全局 dsh 安装解析），那条路径不存在，补丁静默失效。
 *
 * 开关：DSH_FLASH_PRESETS_CONCURRENCY=0 关闭；cordis 配置
 *   toolConcurrency: { enabled?: boolean, tools?: string[] | string, sweepMs?: number }
 * 卸载/插件重建时撤掉标记（ctx.effect）。
 */
const TAG = "[tool-concurrency]";
const MARK = Symbol.for("dsh-flash-presets.tool-concurrency");
const HOOK = Symbol.for("dsh-flash-presets.tool-concurrency.hook");
const DEFAULT_TARGETS = ["glob", "grep"];
// 500ms：会话挂载到它第一轮的工具调用之间通常只有几秒，15s 的扫描会漏掉第一轮
// （2026-11-06 实测：会话 18:53:12.79 挂载，三个 grep 在 18:53:17.88 就发完了，扫描没赶上）。
const DEFAULT_SWEEP_MS = 500;
const WARMUP_MS = 1200;
// 前 60 秒按 sweepMs（默认 500ms）扫：会话挂载到第一轮工具调用只有几秒，慢不得。
// 之后退到 SLOW_SWEEP_MS：新会话有 agent/created 事件即时补标，兜底扫描没必要一直 500ms
// （第四轮审计 P2-4：原来每 500ms 永久全量扫，每次 O(agents × targets)）。
const FAST_WINDOW_MS = 60000;
const SLOW_SWEEP_MS = 5000;
// 只读工具的探测参数：只为确认“分类函数返回 true”，不会真的执行
const PROBE = { pattern: "*" };

function say(level, text) {
  try { (level === "error" ? console.error : console.info)(text); } catch (error) {}
}
function msgOf(error) {
  return String((error && error.message) || error);
}
function serviceOf(ctx, name) {
  try {
    if (ctx[name] !== undefined) return ctx[name];
    if (typeof ctx.get === "function") return ctx.get(name);
  } catch (error) {}
  return undefined;
}
function parseTargets(value) {
  if (Array.isArray(value)) return value.filter((x) => typeof x === "string" && x.length > 0);
  if (typeof value === "string") return value.split(",").map((x) => x.trim()).filter(Boolean);
  return DEFAULT_TARGETS.slice();
}
function getDef(tools, name, scope) {
  try { return scope === undefined ? tools.get(name) : tools.get(name, scope); } catch (error) { return undefined; }
}

/**
 * 在一个作用域里标记一批只读工具为并发安全（幂等）。
 * @param tools - ctx.tools（ToolsService）
 * @param targets - 工具名列表
 * @param scope - agent（省略 = 全局视图）
 * @returns {{marked: string[], kept: string[], missing: string[], failed: string[]}}
 */
export function markConcurrencySafe(tools, targets, scope) {
  const result = { marked: [], kept: [], missing: [], failed: [] };
  if (tools === undefined || tools === null || typeof tools.get !== "function") {
    result.failed.push("tools 服务不可用");
    return result;
  }
  for (const name of targets) {
    const def = getDef(tools, name, scope);
    if (def === undefined || def === null) { result.missing.push(name); continue; }
    if (typeof def.isConcurrencySafe === "function") { result.kept.push(name); continue; }
    try {
      def.isConcurrencySafe = () => true;
      if (def.isConcurrencySafe(PROBE) !== true) { delete def.isConcurrencySafe; result.failed.push(name + "（探测未返回 true）"); continue; }
      result.marked.push(name);
    } catch (error) {
      result.failed.push(name + "（" + msgOf(error) + "）");
    }
  }
  return result;
}

/** 撤掉本模块打上的标记（只删我们加的那个函数；原生声明过的不在该列表里）。 */
export function unmarkConcurrencySafe(tools, names, scope) {
  for (const name of Array.isArray(names) ? names : []) {
    try {
      const def = getDef(tools, name, scope);
      if (def !== undefined && def !== null && typeof def.isConcurrencySafe === "function") delete def.isConcurrencySafe;
    } catch (error) {}
  }
}

/**
 * 在**决策点**上兜底：pipeline 取定义走 ctx.tools.executable(name, scope, toolSet)
 * （pipeline.js:261，this.tools = ctx.tools），所以包住它就能在调度器真正问“这个工具能不能并行”
 * 之前把标记补上——不依赖定时扫描，也就没有“第一轮赶不上”的窗口。
 * @returns 还原函数；不可用/已装过则返回 null
 */
function installExecutableHook(tools, targetSet, onMark) {
  if (tools === null || tools === undefined || typeof tools.executable !== "function") return null;
  let previous = null;
  try { previous = tools[HOOK]; } catch (error) { previous = null; }
  if (previous !== null && previous !== undefined) return null;
  const original = tools.executable;
  const wrapped = function (name, scope, toolSet) {
    const def = original.call(this, name, scope, toolSet);
    try {
      if (def !== null && def !== undefined && targetSet.has(name) && typeof def.isConcurrencySafe !== "function") {
        def.isConcurrencySafe = () => true;
        if (typeof onMark === "function") onMark(def, name);
      }
    } catch (error) {}
    return def;
  };
  try {
    Object.defineProperty(tools, HOOK, { value: { original, wrapped }, configurable: true });
    tools.executable = wrapped;
  } catch (error) {
    return null;
  }
  return () => {
    try {
      if (tools.executable === wrapped) tools.executable = original;
      delete tools[HOOK];
    } catch (error) {}
  };
}

/** 「调度器会怎么判」：pipeline 只认 === true，这里照抄它的判据。 */
function witnessOf(tools, targets, scope) {
  return targets
    .map((name) => {
      let verdict = "n/a";
      try {
        const def = getDef(tools, name, scope);
        if (def !== undefined && def !== null && typeof def.isConcurrencySafe === "function") verdict = String(def.isConcurrencySafe(PROBE) === true);
      } catch (error) { verdict = "?"; }
      return name + "=" + verdict;
    })
    .join(" ");
}

/**
 * 等 tools/agents 就绪后标记：先全局，再按已挂载 agent；之后定时补新 agent。
 * @param ctx - 插件上下文
 * @param options - {enabled?: boolean, tools?: string[] | string, sweepMs?: number}
 */
export function installToolConcurrency(ctx, options) {
  const opts = options !== null && typeof options === "object" ? options : {};
  if (opts.enabled === false || process.env.DSH_FLASH_PRESETS_CONCURRENCY === "0") {
    say("info", TAG + " 未启用（toolConcurrency.enabled=false 或 DSH_FLASH_PRESETS_CONCURRENCY=0）");
    return { installed: false, reason: "disabled" };
  }
  const targets = parseTargets(opts.tools);
  const sweepMs = Number.isFinite(Number(opts.sweepMs)) && Number(opts.sweepMs) >= 1000 ? Math.floor(Number(opts.sweepMs)) : DEFAULT_SWEEP_MS;
  const targetSet = new Set(targets);
  // lazy：决策点勾子上“顺手”标上的定义（不在扫描列表里），卸载时也要撤
  const state = { tools: null, marked: new Map(), loggedScopes: 0, timers: new Set(), hook: null, lazy: new Set() };

  const remember = (key, names, scope) => {
    if (names.length === 0) return;
    const prev = state.marked.get(key);
    state.marked.set(key, { scope, names: [...new Set([...(prev ? prev.names : []), ...names])] });
  };

  /** 扫一遍：全局 + 每个已挂载 agent。返回本轮新增标记数。 */
  const sweep = (child, quiet) => {
    const tools = state.tools === null ? serviceOf(child, "tools") : state.tools;
    if (tools === undefined || tools === null || typeof tools.get !== "function") return 0;
    state.tools = tools;
    if (state.hook === null) {
      state.hook = installExecutableHook(tools, targetSet, (def, name) => { state.lazy.add({ def, name }); }) ?? null;
    }
    let added = 0;
    const global = markConcurrencySafe(tools, targets);
    if (global.marked.length > 0) { remember("__global__", global.marked, undefined); added += global.marked.length; }
    const agents = serviceOf(child, "agents");
    let list = [];
    if (agents !== undefined && agents !== null && typeof agents.list === "function") {
      try { list = agents.list(); } catch (error) { list = []; }
    }
    for (const agent of Array.isArray(list) ? list : []) {
      const result = markConcurrencySafe(tools, targets, agent);
      if (result.marked.length === 0) continue;
      remember(String(agent.id ?? list.indexOf(agent)), result.marked, agent);
      added += result.marked.length;
    }
    if (!quiet) {
      const scopes = state.marked.size - (state.marked.has("__global__") ? 1 : 0);
      if (scopes > state.loggedScopes) {
        state.loggedScopes = scopes;
        let total = 0;
        for (const entry of state.marked.values()) total += entry.names.length;
        const sample = list.length > 0 ? list[list.length - 1] : undefined;
        say("info", TAG + " 已标记 " + targets.join(",") + "（全局视图 + " + scopes + " 个会话作用域，共 " + total + " 处）｜调度器判据 "
          + witnessOf(tools, targets, sample) + (sample === undefined ? "（全局）" : "（最近会话）"));
      }
    }
    return added;
  };

  const pass = () => {
    try { sweep(ctx, false); } catch (error) { say("error", TAG + " 扫描失败（已忽略）:" + msgOf(error)); }
  };

  try {
    ctx.inject(["tools", "agents"], (child) => {
      const warmup = setTimeout(() => {
        try {
          const before = state.marked.size;
          sweep(child, false);
          // 首次诊断始终打一行：证明模块确实在跑，并说明“还没标记”是正常的等待态
          if (state.marked.size === before) {
            const tools = state.tools;
            const globalDef = tools === null ? undefined : getDef(tools, targets[0]);
            const agents = serviceOf(child, "agents");
            let count = 0;
            try { const list = agents !== null && typeof agents.list === "function" ? agents.list() : []; count = Array.isArray(list) ? list.length : 0; } catch (error) {}
            say("info", TAG + " 已启用（目标 " + targets.join(",") + "；全局视图 " + (globalDef === undefined ? "未注册" : "已注册")
              + "；已挂载会话 " + count + "）→ 会话挂载预设后会补标记");
          }
        } catch (error) {}
      }, WARMUP_MS);
      // 自续期定时器：快扫 60s → 慢扫兜底。用 Set 记录存活句柄，卸载时统一清掉。
      const fastUntil = Date.now() + FAST_WINDOW_MS;
      let delayMs = sweepMs;
      const chain = () => {
        const handle = setTimeout(() => {
          state.timers.delete(handle);
          if (Date.now() > fastUntil) delayMs = Math.max(sweepMs, SLOW_SWEEP_MS);
          try { sweep(child, false); } catch (error) {}
          chain();
        }, delayMs);
        try { if (typeof handle.unref === "function") handle.unref(); } catch (error) {}
        state.timers.add(handle);
      };
      chain();
      // 新会话挂载时立刻补标记（扫描只是兜底）
      try {
        child.on("agent/created", (payload) => {
          try {
            const agent = payload !== null && typeof payload === "object" && payload.agent !== undefined ? payload.agent : payload;
            const tools = state.tools === null ? serviceOf(child, "tools") : state.tools;
            if (tools === null || tools === undefined) return;
            const result = markConcurrencySafe(tools, targets, agent);
            const key = agent !== null && agent !== undefined && agent.id !== undefined ? String(agent.id) : "agent-" + state.marked.size;
            if (result.marked.length > 0) remember(key, result.marked, agent);
            try { sweep(child, false); } catch (error) {}
          } catch (error) {}
        });
      } catch (error) {}
      try { if (typeof warmup.unref === "function") warmup.unref(); } catch (error) {}
      state.timers.add(warmup);
      try { sweep(child, false); } catch (error) { say("error", TAG + " 首扫失败（已忽略）:" + msgOf(error)); }
    });
  } catch (error) {
    try { pass(); } catch (error2) {}
  }

  try {
    if (typeof ctx.effect === "function") {
      ctx.effect(() => () => {
        for (const timer of state.timers) { try { clearTimeout(timer); clearInterval(timer); } catch (error) {} }
        state.timers.clear();
        if (typeof state.hook === "function") { try { state.hook(); } catch (error) {} }
        for (const entry of state.lazy) { try { if (typeof entry.def.isConcurrencySafe === "function") delete entry.def.isConcurrencySafe; } catch (error) {} }
        if (state.tools !== null) {
          for (const entry of state.marked.values()) unmarkConcurrencySafe(state.tools, entry.names, entry.scope);
        }
      }, "tool-concurrency: markers");
    }
  } catch (error) {}

  return { installed: true, targets, sweepMs };
}

export const __internals = { markConcurrencySafe, unmarkConcurrencySafe, parseTargets, witnessOf, TAG, PROBE, DEFAULT_TARGETS, DEFAULT_SWEEP_MS };
