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
for (const id of ["flash-presets-core", "flash-presets-alias", "preset-flash-lean-ptc-v3", "preset-flash-lean-ptc-v3-balance"]) {
  const b = rowOf(id);
  check(!!b, "组合配置里有 " + id + " 这一行");
  if (b) check(!/^ {6}disabled: true/m.test(b), id + " 不是 disabled（行级）");
}

if (problems.length > 0) {
  console.error("✖ run_code 优化 A 的「安装即优化」未兑现（" + problems.length + " 处）：");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("✓ run_code 优化 A：独立成行，装上即生效，关掉/缺失都有显性日志");