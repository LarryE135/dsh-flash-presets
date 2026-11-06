// 预设组合的运行期自检（0.2.6 起）。
//
// 背景（2026-11-06 实测事故）：某次插件热重载后，之前已经打开的 22 条会话的 agent
// 预设组合层（tool executor / compaction / command-compact / command-goal / plan-mode）
// 被 cordis 连同旧插件图一起 dispose 掉，且不会自动重挂。用户的体感是
//   · 斜杠菜单里「压缩 compact」「计划 plan」「目标 goal」凭空消失；
//   · 再发一句就报 "The selected tool executor is unavailable."，会话彻底跑不动。
// 会话文件本身完全无损，重启 dsh（或重选一次预设）即恢复 —— 但那需要人**先发现**。
//
// 本模块只做两件事：
//   1. 检测：定时扫一遍**已挂载**的 agent，用两个只读探针判断组合是否还在
//        · commands.list(agent)        → 预设组合提供的命令（默认要求 compact 在）
//        · tools.selectExecutor(agent) → 工具执行器是否仍被选中（纯查找：会抛错但不改状态）
//      「命令层只剩 profile 全局命令」正是事故的指纹（全局 export/feedback/permission 还在）。
//   2. 可选重挂：DSH_FLASH_PRESETS_SELFCHECK_HEAL=1 时，用会话首帧里的 preset id 调一次
//      agentPresets.select(agent, id) 强制重挂。注意这一步**会往会话日志写一条
//      agent-preset/selected 事件**（等同用户在选择器里点了一下），所以默认关闭。
//
// 不改任何会话文件（除非显式开了 heal）；任何异常都只记一条日志，绝不影响宿主。

import { closeSync, existsSync, openSync, readdirSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";

const TAG = "[composition-check]";
const DEFAULT_EXPECT = ["compact"];
const DEFAULT_INTERVAL_MS = 120000;   // 2 分钟扫一次，代价是几十次内存查表
const WARMUP_MS = 6000;               // 激活后先等插件图铺平
const HEAD_CHUNK = 256 * 1024;
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const CACHE_MAX = 500;

const say = (level, text) => { try { (level === "error" ? console.error : console.info)(text); } catch (e) {} };
const short = (id) => String(id).slice(0, 20);

function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  return fromEnv !== undefined && fromEnv !== "" ? fromEnv : join(homedir(), ".dsh");
}

function capSet(map, key, value) {
  if (map.has(key)) map.delete(key);
  else if (map.size >= CACHE_MAX) map.delete(map.keys().next().value);
  map.set(key, value);
}

function parseExpect(value) {
  const raw = value === undefined ? (process.env.DSH_FLASH_PRESETS_SELFCHECK_EXPECT ?? "") : String(value);
  const items = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  return items.length > 0 ? items : DEFAULT_EXPECT.slice();
}

// 会话首帧（只读开头一小段；会话日志是多帧 zstd，整文件解压必然失败）
const presetCache = new Map();
const presetMiss = new Map();

function firstFrameText(file) {
  let fd;
  try {
    fd = openSync(file, "r");
    const chunk = Buffer.alloc(HEAD_CHUNK);
    const n = readSync(fd, chunk, 0, HEAD_CHUNK, 0);
    if (n <= 0) return null;
    const buf = chunk.subarray(0, n);
    const end = buf.indexOf(ZSTD_MAGIC, 4);
    const candidates = [];
    if (end > 4) candidates.push(buf.subarray(0, end));
    candidates.push(buf);
    for (const slice of candidates) {
      try { return zstdDecompressSync(slice).toString("utf8"); } catch (error) {}
    }
    return null;
  } catch (error) {
    return null;
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch (error) {} }
  }
}

/** 会话首帧里的 preset id（重挂用）；读不到返回 null，30 秒内不重复重试。 */
export function headerPresetOf(sessionId) {
  if (sessionId === undefined || sessionId === null) return null;
  const key = dshHome() + "|" + String(sessionId);
  if (presetCache.has(key)) return presetCache.get(key);
  const missedAt = presetMiss.get(key);
  if (missedAt !== undefined && Date.now() - missedAt < 30000) return null;
  let preset = null;
  try {
    const root = join(dshHome(), "sessions");
    // 目录名就是会话 id（"session-<uuid>"）；老布局里也有裸 uuid 的写法，两种都试。
    const names = [String(sessionId), "session-" + String(sessionId)];
    outer: for (const dir of readdirSync(root)) {
      for (const name of names) {
        const file = join(root, dir, name, "session.v4.jsonl.zstd");
        if (!existsSync(file)) continue;
        const text = firstFrameText(file);
        if (text === null) continue;
        const meta = JSON.parse(text.split("\n")[0]);
        const id = meta.agentPreset;
        preset = typeof id === "string" && id.length > 0 ? id : null;
        break outer;
      }
    }
  } catch (error) { preset = null; }
  if (preset !== null) { capSet(presetCache, key, preset); presetMiss.delete(key); }
  else capSet(presetMiss, key, Date.now());
  return preset;
}

function sessionIdOf(agent) {
  if (agent === null || typeof agent !== "object") return null;
  const session = agent.session;
  const id = session !== undefined && session !== null
    ? (session.id !== undefined ? session.id : session.sessionId)
    : agent.id;
  return id === undefined || id === null ? null : id;
}

function serviceOf(ctx, name) {
  try {
    if (ctx[name] !== undefined) return ctx[name];
    if (typeof ctx.get === "function") return ctx.get(name);
  } catch (error) {}
  return undefined;
}

/** 命令层探针：该 agent 可见的命令名；服务不可用时 null。 */
function commandNamesOf(commands, agent) {
  if (commands === undefined || commands === null) return null;
  try { return commands.list(agent).map((c) => c.name); } catch (error) { return null; }
}

/** 执行器探针：selectExecutor 是纯查找（缺失时抛 ToolExecutorUnavailableError）。 */
function executorStateOf(tools, agent) {
  if (tools === undefined || tools === null || typeof tools.selectExecutor !== "function") return undefined;
  try { tools.selectExecutor(agent); return true; } catch (error) { return false; }
}

function describe(names, missing, executor) {
  const parts = [];
  if (names !== null) parts.push("命令层 = " + (names.length > 0 ? names.join(",") : "(空)"));
  if (missing.length > 0) parts.push("缺 " + missing.join("/"));
  if (executor === false) parts.push("工具执行器不可用");
  if (executor === undefined) parts.push("执行器未探测");
  return parts.join("，");
}

function heal(child, agent, id, cfg, names, missing, executor) {
  const presets = serviceOf(child, "agentPresets");
  const preset = headerPresetOf(id);
  if (presets === undefined || typeof presets.select !== "function" || preset === null) {
    say("error", TAG + " ⚠ 会话 " + short(id) + " 组合失效（" + describe(names, missing, executor)
      + "），但无法自动重挂（" + (preset === null ? "读不到会话首帧的 preset id" : "缺少 agentPresets.select") + "）→ 请重启 dsh。");
    return;
  }
  Promise.resolve()
    .then(() => presets.select(agent, preset))
    .then(() => {
      const after = commandNamesOf(serviceOf(child, "commands"), agent) ?? [];
      const still = cfg.expect.filter((name) => !after.includes(name));
      if (still.length > 0) {
        say("error", TAG + " ✗ 重挂 " + preset + " 后会话 " + short(id) + " 仍缺 " + still.join("/") + "（命令层 = " + (after.join(",") || "(空)") + "）→ 请重启 dsh。");
      } else {
        say("info", TAG + " ✓ 已用 " + preset + " 重挂会话 " + short(id) + "，命令层恢复（写入了 1 条 agent-preset/selected 事件）。");
      }
    })
    .catch((error) => {
      say("error", TAG + " ✗ 重挂会话 " + short(id) + " 失败：" + String((error && error.message) || error) + " → 请重启 dsh。");
    });
}

function scan(child, cfg, state) {
  const agents = serviceOf(child, "agents");
  const commands = serviceOf(child, "commands");
  if (agents === undefined || commands === undefined || typeof agents.list !== "function") return;
  let list;
  try { list = agents.list(); } catch (error) { return; }
  if (!Array.isArray(list) || list.length === 0) return;
  const tools = serviceOf(child, "tools");
  let healthy = 0;
  for (const agent of list) {
    const id = sessionIdOf(agent);
    if (id === null) continue;
    const names = commandNamesOf(commands, agent);
    if (names === null) continue;
    const missing = cfg.expect.filter((name) => !names.includes(name));
    const executor = executorStateOf(tools, agent);
    const broken = missing.length > 0 || executor === false;
    if (!broken) { healthy += 1; state.warned.delete(String(id)); continue; }
    if (cfg.heal && !state.healed.has(String(id))) {
      state.healed.add(String(id));
      heal(child, agent, String(id), cfg, names, missing, executor);
      continue;
    }
    if (state.warned.has(String(id))) continue;
    capSet(state.warned, String(id), true);
    say("error", TAG + " ⚠ 会话 " + short(id) + " 的预设组合在运行期失效：" + describe(names, missing, executor)
      + " → 该会话不能调工具，斜杠菜单里也没有「压缩/计划」。会话文件无损；处置：重启 dsh（推荐），"
      + "或在该会话的选择器里重选一次预设。自动重挂开关：DSH_FLASH_PRESETS_SELFCHECK_HEAL=1。");
  }
  state.lastHealthy = healthy;
  state.lastTotal = list.length;
}

function start(child, cfg) {
  const state = { warned: new Map(), healed: new Set(), lastHealthy: 0, lastTotal: 0 };
  const pass = () => {
    try { scan(child, cfg, state); }
    catch (error) { say("error", TAG + " 扫描失败（已忽略）:" + String((error && error.message) || error)); }
  };
  const warmup = setTimeout(pass, WARMUP_MS);
  const timer = setInterval(pass, cfg.intervalMs);
  try {
    if (typeof timer.unref === "function") timer.unref();
    if (typeof warmup.unref === "function") warmup.unref();
  } catch (error) {}
  try {
    if (typeof child.effect === "function") {
      child.effect(() => () => { clearTimeout(warmup); clearInterval(timer); }, "composition-check: timers");
    }
  } catch (error) {}
  say("info", TAG + " 已启用：每 " + Math.round(cfg.intervalMs / 1000) + "s 扫一次已挂载会话（期望命令 " + cfg.expect.join("/") + "，自动重挂 " + (cfg.heal ? "开" : "关") + "）");
}

/**
 * 等 agents/commands 就绪后启动自检；任何异常都只记一条日志。
 * @param ctx - 插件上下文（本插件不 inject 这两个服务，用 ctx.inject 等它们出现）
 * @param options - {enabled?: boolean, expect?: string[] | string, intervalMs?: number, heal?: boolean}
 */
export function scheduleCompositionCheck(ctx, options) {
  const opts = options !== null && typeof options === "object" ? options : {};
  if (opts.enabled === false || process.env.DSH_FLASH_PRESETS_SELFCHECK === "0") {
    say("info", TAG + " 未启用（compositionCheck.enabled=false 或 DSH_FLASH_PRESETS_SELFCHECK=0）");
    return;
  }
  const cfg = {
    expect: parseExpect(opts.expect),
    intervalMs: Number.isFinite(Number(opts.intervalMs)) && Number(opts.intervalMs) >= 10000 ? Number(opts.intervalMs) : DEFAULT_INTERVAL_MS,
    heal: opts.heal === true || process.env.DSH_FLASH_PRESETS_SELFCHECK_HEAL === "1"
  };
  try {
    ctx.inject(["agents", "commands"], (child) => {
      try { start(child, cfg); }
      catch (error) { say("error", TAG + " 启动失败（已忽略）:" + String((error && error.message) || error)); }
    });
  } catch (error) {
    say("error", TAG + " inject 失败（已忽略）:" + String((error && error.message) || error));
  }
}

export const __internals = { scan, parseExpect, describe, sessionIdOf };
