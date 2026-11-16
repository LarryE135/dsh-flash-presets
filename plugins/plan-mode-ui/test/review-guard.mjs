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
  const mod = await import("../lib/index.js?guard" + (++seq) + "-" + Date.now());
  const ctx = {
    get: () => undefined,
    on: () => () => {}, inject: () => {}, effect: (fn) => { try { fn(); } catch (e) {} },
    webServer: { register: () => () => {} },
    systemPrompt: { section: () => () => {}, getSectionOrder: () => 500 },
    logger: { warn() {}, info() {} },
    tools: withGuard ? { guard: (g) => { guards.push(g); return () => {}; } } : {}
  };
  mod.default.apply(ctx);
  const session = { id: "g-" + seq, delegationDepth: 0 };
  return { mod, guards, agent: { session } };
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
if (failed > 0) { console.log(failed + " 项失败"); process.exit(1); }
console.log("全部通过");
