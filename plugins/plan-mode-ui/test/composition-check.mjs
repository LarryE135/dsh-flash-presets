// 组合自检：探针判定（健康/失效）、日志措辞、异常不抛
import { scheduleCompositionCheck, headerPresetOf, __internals } from "../lib/composition-check.js";

let failed = 0;
function eq(name, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error("✗ " + name + "\n  got  " + a + "\n  want " + b); failed += 1; }
  else console.log("✓ " + name);
}
function ok(name, cond) { eq(name, Boolean(cond), true); }

// 捕获日志：模块在调用时才读 console，替换即可
function capture(fn) {
  const lines = [];
  const info = console.info, error = console.error;
  console.info = (...a) => lines.push("I " + a.join(" "));
  console.error = (...a) => lines.push("E " + a.join(" "));
  try { fn(); } finally { console.info = info; console.error = error; }
  return lines;
}

const GLOBALS = ["export", "feedback", "permission"];   // 事故现场只剩 profile 全局命令

function fakeChild(opts) {
  const sel = { calls: [] };
  return {
    sel,
    get(name) { return this[name]; },
    agents: { list: () => opts.agents },
    commands: { list: (agent) => (opts.commands(agent) || []).map((name) => ({ name })) },
    tools: { selectExecutor: (agent) => { if (opts.executorOk(agent)) return { ok: true }; throw new Error("The selected tool executor is unavailable."); } },
    agentPresets: { select: (agent, id) => { sel.calls.push([agent.session.id, id]); return Promise.resolve(id); } }
  };
}
const agentOf = (id) => ({ session: { id } });
const cfg = (over) => Object.assign({ expect: ["compact"], intervalMs: 120000, heal: false }, over);
const state = () => ({ warned: new Map(), healed: new Set(), lastHealthy: 0, lastTotal: 0 });

// ① 健康：命令齐、执行器在 → 不报警
{
  const child = fakeChild({
    agents: [agentOf("session-ok")],
    commands: () => ["compact", "plan", "goal", ...GLOBALS],
    executorOk: () => true
  });
  const st = state();
  const lines = capture(() => __internals.scan(child, cfg(), st));
  eq("健康会话不报警", lines.filter((l) => l.startsWith("E ")), []);
  eq("健康计数", st.lastHealthy, 1);
}

// ② 失效：只剩全局命令 + 执行器抛错 → 一条 error，且提到缺什么
{
  const child = fakeChild({ agents: [agentOf("session-93749935-4429-4d93-bbde")], commands: () => GLOBALS, executorOk: () => false });
  const st = state();
  const lines = capture(() => __internals.scan(child, cfg(), st));
  eq("失效会话报警一次", lines.filter((l) => l.startsWith("E ")).length, 1);
  ok("报警提到缺 compact", lines[0].includes("缺 compact"));
  ok("报警提到执行器不可用", lines[0].includes("工具执行器不可用"));
  ok("报警给出处置", lines[0].includes("重启 dsh"));
  // 第二轮不重复刷屏
  const again = capture(() => __internals.scan(child, cfg(), st));
  eq("同一会话不重复刷屏", again.filter((l) => l.startsWith("E ")), []);
}

// ③ 只有执行器缺、命令齐 → 也算失效（最容易漏的一种）
{
  const child = fakeChild({ agents: [agentOf("session-x")], commands: () => ["compact", "plan", ...GLOBALS], executorOk: () => false });
  const st = state();
  const lines = capture(() => __internals.scan(child, cfg(), st));
  eq("缺执行器也报警", lines.filter((l) => l.startsWith("E ")).length, 1);
  ok("只说执行器", lines[0].includes("工具执行器不可用") && !lines[0].includes("缺 compact"));
}

// ④ heal 开：会话不存在 → 拿不到 preset id，降级为「请重启」，且绝不抛
{
  const child = fakeChild({ agents: [agentOf("session-does-not-exist")], commands: () => GLOBALS, executorOk: () => false });
  const st = state();
  const lines = capture(() => __internals.scan(child, cfg({ heal: true }), st));
  eq("heal 分支只报一次", lines.filter((l) => l.startsWith("E ")).length, 1);
  ok("heal 降级提示重启", lines[0].includes("重启 dsh"));
  eq("没有真的调 select", child.sel.calls, []);
}

// ⑤ 探针容错：服务缺失 / list 抛错 / agent 没有 id → 一律静默返回
{
  const st = state();
  capture(() => __internals.scan({ get: () => undefined }, cfg(), st));
  capture(() => __internals.scan({ agents: { list: () => { throw new Error("boom"); } }, commands: { list: () => [] } }, cfg(), st));
  const noId = { agents: { list: () => [{}] }, commands: { list: () => [{ name: "compact" }] } };
  const lines = capture(() => __internals.scan(noId, cfg(), st));
  eq("没有 id 的 agent 不参与判定", lines.filter((l) => l.startsWith("E ")), []);
  eq("没有 id 的 agent 不计健康", st.lastHealthy, 0);
}

// ⑥ expect 解析：默认 compact；字符串逗号分隔；非法值回落
eq("默认 expect", __internals.parseExpect(undefined), ["compact"]);
eq("自定义 expect", __internals.parseExpect("compact, plan ,goal"), ["compact", "plan", "goal"]);
eq("空串回落默认", __internals.parseExpect("  "), ["compact"]);

// ⑦ sessionIdOf：session.id / session.sessionId / agent.id 三种都认
eq("session.id", __internals.sessionIdOf({ session: { id: "a" } }), "a");
eq("session.sessionId", __internals.sessionIdOf({ session: { sessionId: "b" } }), "b");
eq("agent.id 兜底", __internals.sessionIdOf({ id: "c" }), "c");
eq("null 安全", __internals.sessionIdOf(null), null);

// ⑧ 默认关闭：环境变量置 0 时不 inject（也不抛）
{
  process.env.DSH_FLASH_PRESETS_SELFCHECK = "0";
  let injected = false;
  const lines = capture(() => scheduleCompositionCheck({ inject: () => { injected = true; } }, {}));
  delete process.env.DSH_FLASH_PRESETS_SELFCHECK;
  eq("开关关闭时不 inject", injected, false);
  ok("关闭会说明原因", lines[0].includes("未启用"));
}

// ⑨ 坏 header 不抛：不存在的会话 id
eq("不存在的会话拿不到 preset", headerPresetOf("session-nope-0000"), null);
eq("null id 安全", headerPresetOf(null), null);

// ⑩ heal 成功路径（真读磁盘首帧 + 真调 select）：用临时 DSH_HOME 造一条会话
{
  const { mkdirSync, writeFileSync, mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { zstdCompressSync } = await import("node:zlib");

  const home = mkdtempSync(join(tmpdir(), "dsh-selfcheck-"));
  const sid = "session-heal-success";
  const dir = join(home, "sessions", "--tmp-x--", sid);
  mkdirSync(dir, { recursive: true });
  const header = JSON.stringify({ type: "session", version: 4, id: sid, agentPreset: "flash-lean-ptc-v3" });
  const second = JSON.stringify({ type: "permission/preset", seq: 0, data: { preset: "danger-full-access" } });
  writeFileSync(join(dir, "session.v4.jsonl.zstd"),
    Buffer.concat([zstdCompressSync(Buffer.from(header + "\n", "utf8")), zstdCompressSync(Buffer.from(second + "\n", "utf8"))]));

  const before = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    eq("首帧能读出 preset", headerPresetOf(sid), "flash-lean-ptc-v3");
    let healed = false;
    const child = fakeChild({
      agents: [agentOf(sid)],
      commands: () => (healed ? ["compact", "plan", "goal", ...GLOBALS] : GLOBALS),
      executorOk: () => healed
    });
    child.agentPresets.select = (agent, id) => { healed = true; child.sel.calls.push([agent.session.id, id]); return Promise.resolve(id); };
    const st = state();
    const lines = capture(() => __internals.scan(child, cfg({ heal: true }), st));
    await new Promise((r) => setTimeout(r, 30));   // heal 是 promise 链路，等一拍
    eq("heal 用首帧里的 preset", child.sel.calls, [[sid, "flash-lean-ptc-v3"]]);
    eq("heal 期间不重复报警", lines.filter((l) => l.startsWith("E ")), []);
  } finally {
    if (before === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = before;
    try { rmSync(home, { recursive: true, force: true }); } catch (e) {}
  }
}

if (failed > 0) { console.error("\n" + failed + " 项失败"); process.exit(1); }
console.log("\ncomposition-check: 全部通过");
