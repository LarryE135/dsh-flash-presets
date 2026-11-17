// #29：PTC 预设下，run_code 里调 exit_plan_mode / ask_user_question 却没给足 timeoutMs → 派发前拦下
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let seq = 0, failed = 0;
const ok = (cond, msg) => { if (cond) console.log("  ✓ " + msg); else { failed += 1; console.log("  ✗ " + msg); } };

async function boot({ autoApprove = false, withGuard = true } = {}) {
  const home = mkdtempSync(join(tmpdir(), "pmui-guard-"));
  mkdirSync(join(home, "plan-mode-ui"), { recursive: true });
  writeFileSync(join(home, "plan-mode-ui", "state.json"), JSON.stringify({
    version: 1, default: { tier: "light", scope: "auto", max: false, autoApprove }, sessions: {}
  }));
  process.env.DSH_HOME = home;
  const guards = [];
  const warns = [];
  const mod = await import("../lib/index.js?guard" + (++seq) + "-" + Date.now());
  const ctx = {
    get: () => undefined,
    on: () => () => {}, inject: () => {}, effect: (fn) => { try { fn(); } catch (e) {} },
    webServer: { register: () => () => {} },
    systemPrompt: { section: () => () => {}, getSectionOrder: () => 500 },
    logger: { warn: (m) => { warns.push(m); }, info() {} },
    tools: withGuard ? { guard: (g) => { guards.push(g); return () => {}; } } : {}
  };
  mod.default.apply(ctx);
  const session = { id: "g-" + seq, delegationDepth: 0 };
  return { mod, guards, agent: { session }, warns };
}
const runCode = (code, timeoutMs, agent) => ({ name: "run_code", arguments: timeoutMs === undefined ? { code } : { code, timeoutMs }, agent });
const PLAN = "const res = await tools.exit_plan_mode({ plan });";

console.log("review-guard");
{
  const { mod } = await boot();
  const f = mod.__reviewTimeoutReasonForTest;
  ok(typeof f(runCode(PLAN)) === "string", "无 timeoutMs 的计划评审被拦");
  ok(typeof f(runCode(PLAN, 120000)) === "string", "timeoutMs=120000 仍被拦");
  ok(f(runCode(PLAN, 600000)) === undefined, "timeoutMs=600000 放行");
  ok(typeof f(runCode("await tools.ask_user_question({questions})")) === "string", "ask_user_question 同样被拦");
  ok(f(runCode("await tools.read({path:'a'})")) === undefined, "普通 run_code 不受影响");
  ok(f({ name: "exit_plan_mode", arguments: { plan: "# x" } }) === undefined, "非 run_code 直接放行");
  ok(f(runCode(PLAN), () => true) === undefined, "skip 回调为真时放行");
  ok(/timeoutMs: 600000/.test(f(runCode(PLAN))), "拒绝理由里带上可照抄的 timeoutMs");
}
{
  const { guards, agent } = await boot();
  ok(guards.length === 1, "插件注册了一个 tools.guard");
  ok(typeof guards[0](runCode(PLAN, undefined, agent)) === "string", "人工评审时守卫生效");
  ok(guards[0](runCode(PLAN, undefined, { session: { id: "sub", delegationDepth: 1 } })) === undefined, "子代理会话放行");
}
{
  const { guards, agent } = await boot({ autoApprove: true });
  ok(guards[0](runCode(PLAN, undefined, agent)) === undefined, "自动批准开着时放行（评审瞬间返回，不会超时）");
}
{
  const { guards } = await boot({ withGuard: false });
  ok(guards.length === 0, "宿主没有 guard API 时安静跳过，不抛错");
}
{
  process.env.DSH_FLASH_PRESETS_REVIEW_GUARD = "0";
  const { guards } = await boot();
  ok(guards.length === 0, "DSH_FLASH_PRESETS_REVIEW_GUARD=0 可关闭");
  delete process.env.DSH_FLASH_PRESETS_REVIEW_GUARD;
}
{
  const { mod } = await boot();
  const f = mod.__reviewTimeoutReasonForTest;
  ok(f(runCode('const t = "用 exit_plan_mode 提交计划"; await tools.write({ content: t })')) === undefined,
    "只是提到工具名（写文档/字符串）不再误拦");
  ok(f(runCode("// 不要用 ask_user_question" + String.fromCharCode(10) + "await tools.read({ path: 'a' })")) === undefined,
    "注释里提到工具名不再误拦");
  ok(typeof f(runCode("await tools.exit_plan_mode({ plan })")) === "string",
    "真正的调用形态仍然被拦");
}
{
  // 第四轮：方括号 / 模板键 / .call( 也要拦；注释与字符串里的「调用形态」必须放（本轮审计 P3）
  const { mod } = await boot();
  const f = mod.__reviewTimeoutReasonForTest;
  const NAME = ["ex", "it", "_plan", "_mode"].join("");
  const BT = String.fromCharCode(96);
  ok(typeof f(runCode("await tools[" + JSON.stringify(NAME) + "]({ plan })")) === "string",
    "方括号取值后直接调用被拦");
  ok(typeof f(runCode("await tools[" + JSON.stringify(NAME) + "]?.({ plan })")) === "string",
    "方括号 + 可选调用被拦");
  ok(typeof f(runCode("await tools[" + BT + NAME + BT + "]({ plan })")) === "string",
    "模板字符串键被拦");
  ok(typeof f(runCode("await tools." + NAME + ".call(tools, { plan })")) === "string",
    ".call( 调用被拦");
  ok(f(runCode("/* await " + NAME + "({ plan }) */ await tools.read({ path: 'a' })")) === undefined,
    "块注释里的调用形态不再误拦");
  ok(f(runCode("await tools.write({ content: '调 tools." + NAME + "({ plan }) 提交' })")) === undefined,
    "字符串里的调用形态不再误拦");
  ok(f(runCode("const k = '" + NAME + "' + ''; tools[k]")) === undefined,
    "只取值不调用仍然放行");
}

{
  const { mod, warns } = await boot({ withGuard: false });
  const st = mod.__reviewGuardStatsForTest;
  ok(st.unavailable === true, "宿主无 tools.guard 时标记 unavailable");
  ok(warns.length === 1 && /tools\.guard/.test(warns[0]), "并打一条 warn 说明守卫未启用");
}
{
  process.env.DSH_FLASH_PRESETS_REVIEW_GUARD = "0";
  const { mod, guards } = await boot();
  const st = mod.__reviewGuardStatsForTest;
  ok(guards.length === 0, "环境变量关闭时不注册 guard");
  ok(st.disabled === true, "关闭状态在 debug 里可区分（disabled）");
  delete process.env.DSH_FLASH_PRESETS_REVIEW_GUARD;
}
if (failed > 0) { console.log(failed + " 项失败"); process.exit(1); }
console.log("全部通过");
