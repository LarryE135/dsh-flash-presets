#!/usr/bin/env node
// 最小宿主自测：用仓库 node_modules 里真实的 @deepseek-ai/cordis + dsh-system-prompt + dsh-tools（与 DSH 同版本的包）
// 搭一个 cordis Context，把本插件当普通插件挂上（等价于补丁行 insert 之后 Loader 做的 ctx.plugin(mod, config)），
// 再走 dsh-tools 的真实执行管线（tools.execute）调用 flash_sh。
//
// 需要一个当前平台可运行的 flash-sh：FLASH_SH_TEST_BIN=/path/to/flash-sh（Linux 版用 native/flash-sh/build.sh 编）。
// 非 Windows 上靠 DSH_FLASH_SH_ANY_PLATFORM=1 + binPath 进入开发模式。
//   FLASH_SH_TEST_BIN=... node test/host.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(here, "..");
const repoRoot = path.resolve(pluginDir, "..", "..");

let failed = 0;
const ok = (cond, label, extra = "") => {
  if (cond) console.log("  ✓ " + label);
  else {
    failed += 1;
    console.log("  ✖ " + label + (extra ? "  " + String(extra).slice(0, 600) : ""));
  }
};

const bin = process.env.FLASH_SH_TEST_BIN;
if (!bin || !fs.existsSync(bin)) {
  console.log("host 自测：跳过（未设置 FLASH_SH_TEST_BIN 或文件不存在）");
  process.exit(process.env.FLASH_SH_REQUIRE_BIN === "1" ? 1 : 0);
}

// DSH_HOST_NM=/path/to/node_modules：换一套宿主包（例如某个 DSH 安装的 node_modules）来跑，用来覆盖 engines.dsh 声明的整个范围。
// 不设时按正常的模块解析（仓库根目录的 node_modules）。
const hostNm = process.env.DSH_HOST_NM ? path.resolve(process.env.DSH_HOST_NM) : "";
const hostRequire = createRequire(hostNm ? path.join(hostNm, "__host__.js") : import.meta.url);
const importHost = (name) => import(pathToFileURL(hostRequire.resolve(name)).href);
let cordis, Tools, SystemPrompt, toolsVersion;
try {
  cordis = await importHost("@deepseek-ai/cordis");
  Tools = (await importHost("@deepseek-ai/dsh-tools")).ToolRuntime;
  SystemPrompt = (await importHost("@deepseek-ai/dsh-system-prompt")).SystemPrompt;
  toolsVersion = JSON.parse(fs.readFileSync(hostRequire.resolve("@deepseek-ai/dsh-tools/package.json"), "utf8")).version;
} catch (error) {
  console.log("host 自测：跳过（找不到 @deepseek-ai/cordis / dsh-tools / dsh-system-prompt：" + error.message + "）");
  process.exit(0);
}
console.log("host 自测（cordis + dsh-tools " + toolsVersion + "，flash-sh = " + bin + "）");

const savedEnv = { ...process.env };
delete process.env.DSH_FLASH_SH;
delete process.env.DSH_FLASH_SH_BIN;
process.env.DSH_FLASH_SH_ANY_PLATFORM = "1";

const mod = await import(pathToFileURL(path.join(pluginDir, "lib", "index.js")).href);
console.log("  · Config schema 来源：" + mod.CONFIG_SCHEMA_SOURCE);
// 第 1–4 段只装独立包：相当于 presets 已表态「不提供」，独立行无需等待（等待逻辑在第 5 段单独测）
mod.setPresetsIntent("none");

// 捕获插件日志（插件优先走 ctx.logger，退回 console）
const logs = [];
for (const level of ["info", "warn", "error"]) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    const line = args.map(String).join(" ");
    if (line.includes("[flash-sh]")) logs.push(line);
    else orig(...args);
  };
}
const sawLog = (re) => logs.some((l) => re.test(l));

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function newHost() {
  const ctx = new cordis.Context();
  ctx.logger.exporter({
    export(message) {
      const line = cordis.Logger.format({ colors: false }, message);
      if (line.includes("[flash-sh]")) logs.push(line);
    },
  });
  ctx.plugin(SystemPrompt);
  ctx.plugin(Tools, {});
  await tick();
  // DSH 0.2.2 起 dsh-tools 只做登记与分派，执行交给单独挂载的 executor（不挂就抛 TOOL_EXECUTOR_UNAVAILABLE）。
  // 有 setExecutor 就挂一个 native executor：优先用宿主自带的 @deepseek-ai/dsh-tool-executor-native，找不到就用
  // dsh-tools/pipeline 现场装一个等价的（与 native executor 源码相同：executeToolBatch + ToolExecutionPipeline）。
  if (typeof ctx.tools.setExecutor === "function") {
    ctx.plugin(await nativeExecutorPlugin());
    await tick();
  }
  return ctx;
}
let executorPlugin;
async function nativeExecutorPlugin() {
  if (executorPlugin) return executorPlugin;
  try {
    if (process.env.DSH_HOST_INLINE_EXECUTOR === "1") throw new Error("forced inline executor");
    executorPlugin = await importHost("@deepseek-ai/dsh-tool-executor-native");
    executorSource = "@deepseek-ai/dsh-tool-executor-native";
  } catch {
    const { projectToolSchema } = await importHost("@deepseek-ai/dsh-tools");
    const { ToolExecutionPipeline, executeToolBatch } = await importHost("@deepseek-ai/dsh-tools/pipeline");
    executorPlugin = {
      name: "test-native-tool-executor",
      inject: ["tools"],
      apply(ctx) {
        const pipeline = new ToolExecutionPipeline(ctx);
        ctx.tools.setExecutor({
          describe: (tools) => ({ schemas: tools.map((d) => projectToolSchema(d, false)) }),
          execute: (input) => executeToolBatch(input, pipeline, () => 10),
        });
      },
    };
    executorSource = "测试内置（dsh-tools/pipeline）";
  }
  return executorPlugin;
}
let executorSource = "";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flash-sh-host-"));
let callN = 0;
// 两代调用接口：≤0.2.1 的 tools.execute(单次调用) 直接返回结果；0.2.2 起 tools.execute({ calls }) 交给 executor 跑一批，
// 返回 { results: [{ callId, result }] }，参数是模型给的 JSON 字符串。
async function call(ctx, args, signal) {
  const callId = "c" + ++callN;
  signal ??= new AbortController().signal;
  if (typeof ctx.tools.setExecutor !== "function") return ctx.tools.execute({ callId, name: "flash_sh", arguments: args, signal });
  const batch = await ctx.tools.execute({ calls: [{ id: callId, name: "flash_sh", arguments: JSON.stringify(args) }], signal });
  return batch.results.find((r) => r.callId === callId)?.result;
}
const valueOf = (res) => res && (res.value ?? res.structured ?? res.output ?? res.result);

// ── 1. 默认关闭：不注册 ─────────────────────────────────────────────────────
{
  const ctx = await newHost();
  logs.length = 0;
  const fiber = ctx.plugin(mod, { binPath: bin });
  await fiber;
  await tick();
  ok(ctx.tools.get("flash_sh") === undefined, "默认 enabled:false → 不注册");
  ok(sawLog(/not registered: disabled/), "日志说明未注册原因", logs.join(" | "));
  // 配置校验：错误类型被 cordis 拒绝（Config["~standard"].validate 生效）
  let rejected = false;
  try {
    const f = ctx.plugin(mod, { enabled: "yes", binPath: bin });
    await f;
    rejected = ctx.tools.get("flash_sh") === undefined;
  } catch (error) {
    rejected = true;
  }
  ok(rejected, "config.enabled 非布尔 → 校验拒绝 / 不注册");
  ctx.registry.delete?.(mod);
}

// ── 2. 开启 → 注册 → 经 tools.execute 执行 ──────────────────────────────────
const ctx = await newHost();
logs.length = 0;
const fiber = ctx.plugin(mod, { enabled: true, binPath: bin, maxOutputBytes: 4096, approval: "off" });
await fiber;
await tick();
ok(ctx.tools.get("flash_sh") !== undefined, "enabled:true + ANY_PLATFORM + binPath → 已注册");
ok(sawLog(/\[flash-sh\] flash_sh registered \(/), "日志含 \"[flash-sh] flash_sh registered\"", logs.join(" | "));
const schemas = ctx.tools.schemas();
ok(schemas.some((s) => s.name === "flash_sh"), "出现在模型可见 schema（native 模式）");
// PTC：SDK 投影里也有它（run_code 程序内可调）
// ≤0.2.1 有 tools.sdkSchemas()；0.2.2 起 SDK 由 PTC executor 从定义生成，没有这个方法 → 改查定义本身带对象型输出 schema
// （PTC executor 生成返回类型所需的就是它）。
if (typeof ctx.tools.sdkSchemas === "function") {
  try {
    const sdk = ctx.tools.sdkSchemas();
    ok(sdk.some((s) => s.name === "flash_sh" && s.output && s.output.type === "object"), "出现在 PTC SDK 投影（sdkSchemas），带输出 schema");
  } catch (error) {
    ok(false, "sdkSchemas()", error.message);
  }
} else {
  const defs = typeof ctx.tools.definitions === "function" ? ctx.tools.definitions() : [ctx.tools.get("flash_sh")];
  const def = defs.find((d) => d && d.name === "flash_sh");
  const out = def && def.output && (def.output.schema ?? def.output);
  ok(out && out.type === "object", "定义带对象型输出 schema（本宿主没有 sdkSchemas，PTC SDK 由 executor 生成）", JSON.stringify(def && def.output));
  console.log("  · executor：" + executorSource);
}

let res = await call(ctx, { command: 'x=$((6*7)); echo "v=$x"; printf "b\\na\\n" | sort | tr a-z A-Z; pwd', workdir: tmp });
let v = valueOf(res);
ok(res.isError !== true && v && v.exitCode === 0 && v.stdout.startsWith("v=42\nA\nB\n"), "执行一条命令（tools.execute 管线）", JSON.stringify(res));
ok(v && v.stdout.trim().endsWith(path.basename(tmp)), "workdir 生效", v && v.stdout);
const text = JSON.stringify(res.content ?? res);
ok(/v=42/.test(text), "render 输出进入 content", text.slice(0, 200));

res = await call(ctx, { command: "echo out; echo err >&2; exit 7", workdir: tmp });
v = valueOf(res);
ok(v && v.exitCode === 7 && v.stdout === "out\n" && v.stderr === "err\n", "退出码与 stderr 分离", JSON.stringify(v));

let t0 = Date.now();
res = await call(ctx, { command: "sleep 30", timeoutMs: 1000, workdir: tmp });
v = valueOf(res);
ok(v && v.exitCode === 124 && v.timedOut === true && Date.now() - t0 < 8000, "超时 → 124 + timedOut 且及时返回（" + (Date.now() - t0) + "ms）", JSON.stringify(v));

res = await call(ctx, { command: "seq 1 20000", workdir: tmp });
v = valueOf(res);
ok(v && v.truncated === true && v.stdout.startsWith("1\n2\n") && v.stdout.trimEnd().endsWith("19999\n20000") && /bytes omitted/.test(v.stdout) && typeof v.spillPath === "string" && fs.existsSync(v.spillPath), "大输出：保留头尾、中间标注省略、全文落盘", v && v.stdout.length);
if (v && v.spillPath) {
  const full = fs.readFileSync(v.spillPath, "utf8");
  ok(full.startsWith("1\n2\n") && full.endsWith("\n20000\n"), "落盘文件是完整输出");
  if (process.platform !== "win32") ok((fs.statSync(v.spillPath).mode & 0o777) === 0o600, "落盘文件 0600");
  ok(path.basename(path.dirname(v.spillPath)).startsWith(mod.SPILL_PREFIX), "落盘在 mkdtemp 的 " + mod.SPILL_PREFIX + "* 目录里");
  fs.rmSync(v.spillPath, { force: true });
}
res = await call(ctx, { command: "exit 124", workdir: tmp });
v = valueOf(res);
ok(v && v.exitCode === 124 && v.timedOut === false, "脚本自己 exit 124 → 不算超时", JSON.stringify(v));
process.env.HOST_TEST_API_KEY = "leak";
process.env.DSH_HOST_TEST = "leak";
res = await call(ctx, { command: "env", workdir: tmp });
v = valueOf(res);
ok(v && v.exitCode === 0 && !/HOST_TEST_API_KEY|DSH_HOST_TEST/.test(v.stdout) && /PATH=/.test(v.stdout), "子进程环境已脱敏（真实 exe 里 env 看不到 *_KEY / DSH_*）");
delete process.env.HOST_TEST_API_KEY;
delete process.env.DSH_HOST_TEST;

// 取消：外部 AbortSignal → 杀进程
{
  const ac = new AbortController();
  t0 = Date.now();
  const p = call(ctx, { command: "sleep 30", workdir: tmp }, ac.signal);
  setTimeout(() => ac.abort(new Error("user cancelled")), 300);
  res = await p;
  ok(Date.now() - t0 < 5000, "取消 → 及时返回（" + (Date.now() - t0) + "ms）", JSON.stringify(res).slice(0, 300));
}

res = await call(ctx, { command: "echo hi", bogus: 1 });
ok(res.isError === true || /unknown argument|not a declared property/i.test(JSON.stringify(res)), "未知参数被拒", JSON.stringify(res).slice(0, 300));

// ── 3. 审批闸：flash_sh 不受沙箱约束，会话不是「完全访问」时请求审批；同会话同类命令记住 ─────────────
{
  let asked = 0;
  let answer = "rejected";
  let mode = "workspace-write";
  const fakeAgent = {
    session: { id: "s1" },
    ctx: {
      get(name) {
        if (name === "sandboxPolicy") return mode === undefined ? undefined : { resolve: () => ({ mode }) };
        if (name === "approval") return { request: async (req) => { asked += 1; if (answer === "throw") throw new Error("boom"); return req.toolName === "flash_sh" ? answer : "unavailable"; } };
        if (name === "workingDirectory") return { ensure: async () => tmp };
        return undefined;
      },
    },
  };
  const def = mod.toolDefinition(ctx, mod.resolveConfig({ enabled: true, binPath: bin }), bin);
  const run = (command, id) => def.execute({ command }, { agent: fakeAgent, callId: id, signal: new AbortController().signal });
  let threw = "";
  try { await run("echo should-not-run > marker.txt", "a1"); } catch (error) { threw = error.message; }
  ok(asked === 1 && /approval rejected/.test(threw) && !fs.existsSync(path.join(tmp, "marker.txt")), "默认（sandboxed）+ workspace-write 会话：先请求审批，拒绝则不执行", threw);
  answer = "throw";
  threw = "";
  try { await run("echo should-not-run > marker.txt", "a1b"); } catch (error) { threw = error.message; }
  ok(asked === 2 && /approval request failed/.test(threw) && !fs.existsSync(path.join(tmp, "marker.txt")), "审批调用出错 → 拒绝执行", threw);
  answer = "allowed-once";
  let r = await run("pwd", "a2");
  ok(asked === 3 && r.exitCode === 0 && r.stdout.trim().endsWith(path.basename(tmp)), "批准后执行，且用 workingDirectory.ensure 的目录", JSON.stringify(r));
  r = await run("pwd -P", "a2b");
  ok(asked === 3 && r.exitCode === 0, "同会话同类命令（pwd）不再问");
  r = await run("rm -rf nothing-here", "a2c");
  r = await run("rm -rf nothing-here", "a2d");
  ok(asked === 5, "rm -rf 每次都问");
  mode = undefined;
  r = await run("echo x", "a2e");
  ok(asked === 6 && r.stdout === "x\n", "拿不到会话模式 → 仍然请求审批（失败即关闭）");
  mode = "danger-full-access";
  r = await run("echo free", "a3");
  ok(asked === 6 && r.stdout === "free\n", "完全访问会话：不弹审批");
  const ro = mod.toolDefinition(ctx, mod.resolveConfig({ enabled: true, binPath: bin, approval: "read-only" }), bin);
  mode = "workspace-write";
  r = await ro.execute({ command: "echo ww" }, { agent: fakeAgent, callId: "a4", signal: new AbortController().signal });
  ok(asked === 6 && r.stdout === "ww\n", "approval=read-only：工作区可写会话不弹审批");
}

// ── 4. 撞名：另一个插件已注册 flash_sh → 本插件跳过；对方消失后接管 ────────────
{
  const host = await newHost();
  logs.length = 0;
  const other = {
    name: "other-flash-sh",
    inject: ["tools"],
    apply(c) {
      c.tools.register({
        name: "flash_sh",
        description: "other",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        output: { schema: { type: "object", properties: {}, additionalProperties: false }, render: () => [{ type: "text", text: "other" }] },
        execute: async () => ({}),
      });
    },
  };
  const otherFiber = host.plugin(other);
  await otherFiber;
  const mine = host.plugin(mod, { enabled: true, binPath: bin });
  await mine;
  await tick();
  ok(host.tools.get("flash_sh")?.description === "other", "已有 flash_sh → 不覆盖、不抛错");
  ok(sawLog(/already registered by another plugin/), "日志记录跳过", logs.join(" | "));
  await otherFiber.dispose();
  await tick(50);
  ok(host.tools.get("flash_sh")?.description === mod.DESCRIPTION, "对方注销后本插件接管 flash_sh");
  ok(sawLog(/took over/), "日志记录接管", logs.join(" | "));
}

// ── 5. 与 dsh-flash-presets 的 flashSh 子功能同时启用：只有一个 flash_sh（归 presets），两边都不报错 ───────
{
  const presetsPlugin = mod.createPlugin({ owner: "dsh-flash-presets" });
  for (const order of ["presets-first", "standalone-first"]) {
    const host = await newHost();
    logs.length = 0;
    // 真实启动顺序：flash-presets 行 apply 一开始就表态 pending（lib/bundle.js），子功能登记后变成 claimed
    mod.presetsIntent().state = undefined;
    if (order === "standalone-first") mod.setPresetsIntent("pending");
    if (order === "presets-first") ok(mod.registryKey(host.tools) !== mod.SHARED_REGISTRY_KEY && mod.registryKey(host.tools) === mod.registryKey(host.tools), "真实 dsh-tools " + toolsVersion + "：ToolsService 有 layers 字段，经代理读出同一对象");
    let errors = 0;
    const fibers = {};
    const load = async (key, m, cfg) => {
      try { const f = host.plugin(m, cfg); fibers[key] = f; await f; } catch (error) { errors += 1; }
    };
    if (order === "presets-first") {
      await load("p", presetsPlugin, { enabled: true, binPath: bin, approval: "off" });
      await load("s", mod, { enabled: true, binPath: bin, approval: "off" });
    } else {
      await load("s", mod, { enabled: true, binPath: bin, approval: "off" });
      await load("p", presetsPlugin, { enabled: true, binPath: bin, approval: "off" });
    }
    await tick();
    const n = host.tools.schemas().filter((s) => s.name === "flash_sh").length;
    const active = mod.claimsSnapshot(host.tools).filter((c) => c.active).map((c) => c.owner);
    ok(n === 1 && errors === 0 && active.length === 1 && active[0] === "dsh-flash-presets", "同时启用（" + order + "）：flash_sh 恰好 1 个、归 presets、无插件失败", "n=" + n + " errors=" + errors + " active=" + active + " " + logs.join(" | "));
    ok(sawLog(/skips registering it/), "（" + order + "）独立行记日志让位", logs.join(" | "));
    ok(!sawLog(/handed over/) && !logs.some((l) => /\[flash-sh\] flash_sh registered/.test(l)), "（" + order + "）独立行从未注册过（没有「先注册再交出」的双注册窗口）", logs.join(" | "));
    await fibers.p.dispose();
    await tick(50);
    const res2 = await call(host, { command: "echo after-handover", workdir: tmp });
    ok(host.tools.schemas().filter((s) => s.name === "flash_sh").length === 1 && JSON.stringify(res2).includes("after-handover"), "（" + order + "）presets 卸载后独立行接管并能执行", JSON.stringify(res2).slice(0, 300));
    await fibers.s.dispose();
    await tick(20);
  }
}

// ── 5b. 什么都不知道（没有加载器配置树、presets 也没表态）：独立行短等；presets 在时限内到来 → 仍然没有双注册 ──
{
  mod._setDeferTimings({ short: 1500 });
  const host = await newHost();
  logs.length = 0;
  mod.presetsIntent().state = undefined;
  const s = host.plugin(mod, { enabled: true, binPath: bin, approval: "off" });
  await s;
  await tick(200);
  ok(host.tools.get("flash_sh") === undefined && sawLog(/waiting up to 1500 ms/), "未知情况：独立行先等，不注册", logs.join(" | "));
  const p = host.plugin(mod.createPlugin({ owner: "dsh-flash-presets" }), { enabled: true, binPath: bin, approval: "off" });
  await p;
  await tick();
  ok(host.tools.schemas().filter((x) => x.name === "flash_sh").length === 1 && !sawLog(/handed over/) && mod.claimsSnapshot(host.tools).find((c) => c.active)?.owner === "dsh-flash-presets", "presets 在时限内到来：只注册它，独立行没注册过");
  await p.dispose();
  await tick(50);
  ok(host.tools.get("flash_sh") !== undefined, "presets 卸载 → 独立行接管");
  await s.dispose();
  // 只有独立行：时限一过就注册
  logs.length = 0;
  mod.presetsIntent().state = undefined;
  const s2 = host.plugin(mod, { enabled: true, binPath: bin, approval: "off" });
  await s2;
  await tick(1800);
  ok(host.tools.get("flash_sh") !== undefined && sawLog(/did not report within 1500 ms/), "只有独立行：时限一过就注册", logs.join(" | "));
  await s2.dispose();
  mod._setDeferTimings({ short: 3000 });
  mod.setPresetsIntent("none");
}

// ── 6. 缺二进制 / 非 Windows 无 ANY_PLATFORM ───────────────────────────────
{
  delete process.env.DSH_FLASH_SH_ANY_PLATFORM;
  const cfg = mod.resolveConfig({ enabled: true, binPath: bin });
  const d = mod.decide(cfg, "linux", "x64");
  ok(d.register === false && /only active on Windows x64/.test(d.reason), "非 Windows、未开 ANY_PLATFORM → 不注册");
  ok(mod.decide(mod.resolveConfig({ enabled: true }), "win32", "arm64").register === false, "Windows arm64 → 不注册");
  process.env.DSH_FLASH_SH_ANY_PLATFORM = "1";
  ok(mod.decide(mod.resolveConfig({ enabled: true, binPath: path.join(tmp, "nope") })).register === false, "缺二进制 → 不注册");
}

fs.rmSync(tmp, { recursive: true, force: true });
for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
Object.assign(process.env, savedEnv);

if (failed > 0) {
  console.log("host 自测：" + failed + " 项失败");
  process.exit(1);
}
console.log("host 自测：全部通过");
process.exit(0);
