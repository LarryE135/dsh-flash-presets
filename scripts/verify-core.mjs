#!/usr/bin/env node
// run_code 优化 A 的「安装即优化」守卫（0.4）。
//
// 这条守卫防的是 0.3.0 那个结构问题：A 当时搭的是 plan-mode-ui 那行的车，
// 关掉计划模式、或用只挂部分行的精简组合，优化就静默消失——日志里一个字都没有。
// 这里用假 ctx 直接跑 lib/core.js，断言四件事：
//   ① core 是独立行，只 inject tools/agents（不依赖 webServer / systemPrompt）；
//   ② 默认装上即生效：一行日志带版本 + witness，且状态 active；
//   ③ 关掉必须显性：DSH_FLASH_PRESETS_CONCURRENCY=0 时是「未启用」而不是静默；
//   ④ 工具还没注册时说「未生效 + 原因」，不假装成功。
import { coreStatus } from "../lib/core.js";
import core from "../lib/core.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const problems = [];
const check = (ok, label, detail) => {
  if (ok) console.log("  ✓ " + label);
  else problems.push(label + (detail ? "：" + detail : ""));
};

function toolsWith(names) {
  const defs = new Map(names.map((n) => [n, { name: n }]));
  return {
    get: (n) => defs.get(n),
    executable: (n) => defs.get(n),
    register() { throw new Error("test stub: register 不该被调用"); },
  };
}

function mount(tools, env) {
  const logs = [];
  const info = console.info;
  const warn = console.warn;
  console.info = (...a) => logs.push(a.join(" "));
  console.warn = (...a) => logs.push(a.join(" "));
  const child = { tools, agents: { list: () => [] }, on: () => {} };
  const ctx = { inject: (names, cb) => cb(child), effect: (fn) => { fn(); }, get: () => undefined };
  try {
    core.apply(ctx, {});
  } finally {
    console.info = info;
    console.warn = warn;
  }
  return logs;
}

// ① 结构：独立行、不注入宿主特有的服务
check(core && typeof core.apply === "function", "core 有 apply()");
check(Array.isArray(core.inject) && core.inject.join(",") === "tools,agents", "core 只 inject tools,agents", JSON.stringify(core.inject));
check(!(core.inject || []).some((n) => n === "webServer" || n === "systemPrompt"), "core 不依赖 webServer / systemPrompt");

// ② 装上即生效
delete process.env.DSH_FLASH_PRESETS_CONCURRENCY;
const okLogs = mount(toolsWith(["glob", "grep", "read"]));
const line = okLogs.find((l) => /\[tool-concurrency\] v\d+\.\d+\.\d+ 生效/.test(l)) || "";
check(line.length > 0, "装上即打出一行带版本的「生效」日志", okLogs.join(" | ").slice(0, 160));
check(/targets=glob,grep/.test(line), "日志里写明 targets=glob,grep", line);
check(/witness=glob=true grep=true/.test(line), "日志里 witness 为 true（调度器判据）", line);
check(coreStatus().active === true, "状态下 active=true");

// ③ 关掉必须显性
process.env.DSH_FLASH_PRESETS_CONCURRENCY = "0";
const offLogs = mount(toolsWith(["glob", "grep"]));
check(offLogs.some((l) => /未启用/.test(l) && /DSH_FLASH_PRESETS_CONCURRENCY/.test(l)), "关掉时打出「未启用 + 原因」", offLogs.join(" | ").slice(0, 160));
check(coreStatus().active === false, "关掉后 active=false");
delete process.env.DSH_FLASH_PRESETS_CONCURRENCY;

// ④ 工具还没注册：说清原因，不假装成功（warmup 在 1.2 s 后，捕获窗口要盖住它）
const missingLogs = [];
const info0 = console.info;
const warn0 = console.warn;
console.info = (...a) => missingLogs.push(a.join(" "));
console.warn = (...a) => missingLogs.push(a.join(" "));
try {
  mount(toolsWith(["read"]));
  await new Promise((r) => setTimeout(r, 1400));
} finally {
  console.info = info0;
  console.warn = warn0;
}
check(missingLogs.some((l) => /未生效/.test(l) && /工具尚未注册/.test(l)), "工具缺失时打「未生效 + 原因」", missingLogs.join(" | ").slice(0, 160));


// ⑤ 组合配置（第七轮审计 A8）：别名行与两份冻结预设不能是 disabled —— 那会让「旧会话可打开」
// 与「预设能选」静默失效，而 compose --check 是唯一会拦的地方。行的键写在缩进 6，插件行的
// disabled 在缩进 12 以上，因此只认 /^ {6}disabled: true/ 这一层，不会误伤「停用某个工具」。
const composedPath = fileURLToPath(new URL("../cordis.patch.yml", import.meta.url));
const composed = await readFile(composedPath, "utf8");
const rowBlocks = composed.split(/\n(?=- insert:)/);
const rowOf = (id) => rowBlocks.find((b) => new RegExp("^(?:\\s*)- id: " + id.replace(/[-]/g, "\\-") + "$", "m").test(b));
for (const id of ["flash-presets", "preset-flash-lean-ptc-v3", "preset-flash-lean-ptc-v3-balance"]) {
  const b = rowOf(id);
  check(!!b, "组合配置里有 " + id + " 这一行");
  if (b) check(!/^ {6}disabled: true/m.test(b), id + " 不是 disabled（行级）");
}

// ⑥ 单行组合（0.3.4）：4 个运行时功能挂在 id: flash-presets 一行下面。
//   · 旧的 4 个行 id 不能再出现在组合配置里（否则插件页又变回 4 个组件，且与新行重复启动）；
//   · 新行自身 inject 为空（任何宿主上都立即运行），子功能各自 inject；
//   · 任一子模块加载失败（本仓库裸跑时 @deepseek-ai/dsh-llm / zod 解析不到）不连累别名层与优化 A；
//   · 按旧行 id 写的覆盖能换算、优先级正确；
//   · 组合配置里新行的默认值与 lib/row-overrides.js 的 BUNDLE_DEFAULTS 一致。
for (const old of ["flash-presets-core", "flash-presets-alias", "plan-mode-ui", "delivery-gate"]) {
  check(!new RegExp("^\\s*- id: " + old + "$", "m").test(composed), "组合配置里不再有旧行 " + old);
}
const ro = await import("../lib/row-overrides.js");
const flashRow = rowOf("flash-presets") || "";
const expectBlock = ["      config:", ...Object.entries(ro.BUNDLE_DEFAULTS).flatMap(([k, v]) => ["        " + k + ":", ...Object.entries(v).map(([k2, v2]) => "          " + k2 + ": " + v2)])].join("\n");
check(flashRow.includes("name: 'dsh-flash-presets'") && flashRow.includes(expectBlock), "flash-presets 行指向包根且默认值 = BUNDLE_DEFAULTS", flashRow.slice(0, 400));
{
  const c = ro.collectRowOverrides([
    { id: "delivery-gate", config: { enabled: true, scripts: ["v.sh"] } },
    { id: "flash-presets-core", config: { toolConcurrency: { enabled: false } } },
    { id: "flash-presets-alias", disabled: true },
    { id: "plan-mode-ui", disabled: true, config: { lagTurns: 5, enabled: true } },
    { id: "flash-presets", config: { deliveryGate: { maxRounds: 4 }, alias: { enabled: true } } },
    { insert: [{ id: "delivery-gate", name: "x" }] },
    { id: "unrelated", disabled: true },
  ]);
  const e = ro.effectiveConfig({ toolConcurrency: { enabled: true }, deliveryGate: { enabled: false, maxRounds: 2 } }, c);
  check(c.found.length === 4, "旧行覆盖识别 4 处（insert 与无关行不算）", JSON.stringify(c.found.map((f) => f.id)));
  check(e.deliveryGate.enabled === true && e.deliveryGate.scripts[0] === "v.sh" && e.deliveryGate.maxRounds === 4, "delivery-gate 旧覆盖生效，新 id 覆盖优先", JSON.stringify(e.deliveryGate));
  check(e.toolConcurrency.enabled === false, "flash-presets-core 的 toolConcurrency.enabled=false 沿用");
  check(e.planMode.enabled === false && e.planMode.lagTurns === 5, "plan-mode-ui 的 disabled:true → 计划模式关、其余配置保留", JSON.stringify(e.planMode));
  check(e.alias.enabled === true, "新 id 上显式 alias.enabled=true 压过旧行 disabled");
  const e2 = ro.effectiveConfig({ deliveryGate: { enabled: true } }, ro.collectRowOverrides([]));
  check(e2.toolConcurrency.enabled === true && e2.alias.enabled === true && e2.planMode.enabled === true && e2.deliveryGate.maxRounds === 2,
    "用户整段替换新行 config 时，缺的键回落到组合包默认值", JSON.stringify(e2));
  const js = ro.collectRowOverrides([{ id: "delivery-gate", disabled: { __expr: "process.platform" } }]);
  check(js.found.length === 1 && /无法换算/.test(js.found[0].note || ""), "!!js 形式的 disabled 不静默吞掉，带说明");
}
{
  const bundle = await import("../lib/bundle.js");
  check(Array.isArray(bundle.inject) && bundle.inject.length === 0, "flash-presets 行本身 inject 为空（桌面端缺 webServer 也立即运行）");
  const mounted = [];
  const logs = [];
  const fakeCtx = { get: () => undefined, plugin: (p, cfg) => { mounted.push({ name: p && p.name, inject: p && p.inject, cfg }); } };
  const saved = { info: console.info, warn: console.warn, error: console.error };
  console.info = console.warn = console.error = (...a) => logs.push(a.join(" "));
  try { await bundle.apply(fakeCtx, ro.BUNDLE_DEFAULTS); } finally { Object.assign(console, saved); }
  const st = bundle.bundleState();
  check(st.features.alias === "mounted" && st.features.core === "mounted", "别名层与优化 A 不受其他子模块加载失败影响", JSON.stringify(st.features));
  check(logs.some((l) => /没能读取 profile 补丁/.test(l)), "读不到 profile 补丁时显性告警（不静默跳过旧覆盖）");
  const aliasMount = mounted.find((m) => m.name === "dsh-flash-presets/alias");
  check(!!aliasMount && JSON.stringify(aliasMount.inject) === '["agentPresets"]', "别名层作为子插件只 inject agentPresets");
  const coreMount = mounted.find((m) => m.name === "flash-presets-core");
  check(!!coreMount && coreMount.cfg.toolConcurrency.enabled === true, "优化 A 子插件拿到 toolConcurrency 配置");
  for (const [k, v] of Object.entries(st.features)) {
    if (k === "planMode" || k === "deliveryGate") check(v === "mounted" || /^load-failed/.test(v), k + " 已挂载或明确记为 load-failed", v);
  }
}

if (problems.length > 0) {
  console.error("✖ run_code 优化 A 的「安装即优化」未兑现（" + problems.length + " 处）：");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("✓ run_code 优化 A：独立成行，装上即生效，关掉/缺失都有显性日志");