// tool-concurrency：在已注册的定义对象上补 isConcurrencySafe（调度器只认 === true）
import assert from "node:assert/strict";

const { markConcurrencySafe, unmarkConcurrencySafe, installToolConcurrency, __internals } = await import("../lib/tool-concurrency.js");

let passed = 0;
let failed = 0;
const check = async (name, fn) => {
  try { await fn(); passed++; console.log("  ok   " + name); }
  catch (error) { failed++; console.log("  FAIL " + name + " :: " + (error && error.message)); }
};
const makeTools = (globalDefs, scoped = {}) => ({
  get(name, scope) {
    if (scope === undefined) return globalDefs[name];
    return scoped[scope.id]?.[name];
  }
});
const quiet = async (fn) => {
  const origInfo = console.info;
  const origError = console.error;
  const logs = [];
  console.info = (line) => logs.push(String(line));
  console.error = (line) => logs.push(String(line));
  try { await fn(logs); } finally { console.info = origInfo; console.error = origError; }
};

await check("标记 glob/grep：分类函数返回 true", () => {
  const defs = { glob: { name: "glob" }, grep: { name: "grep" } };
  const r = markConcurrencySafe(makeTools(defs), ["glob", "grep"]);
  assert.deepEqual(r.marked, ["glob", "grep"]);
  assert.equal(defs.glob.isConcurrencySafe({ pattern: "*" }), true);
});

await check("幂等：第二次是 kept", () => {
  const defs = { glob: { name: "glob", isConcurrencySafe: () => true } };
  const r = markConcurrencySafe(makeTools(defs), ["glob"]);
  assert.deepEqual(r.marked, []);
  assert.deepEqual(r.kept, ["glob"]);
});

await check("上游已声明的不覆盖（函数身份不变）", () => {
  const upstream = () => false;
  const defs = { grep: { name: "grep", isConcurrencySafe: upstream } };
  markConcurrencySafe(makeTools(defs), ["grep"]);
  assert.equal(defs.grep.isConcurrencySafe, upstream);
});

await check("按 agent 作用域标记（预设组合是每 agent 一份）", () => {
  const agentA = { id: "a" };
  const scoped = { a: { glob: { name: "glob" } } };
  const r = markConcurrencySafe(makeTools({}, scoped), ["glob"], agentA);
  assert.deepEqual(r.marked, ["glob"]);
  assert.equal(scoped.a.glob.isConcurrencySafe({ pattern: "*" }), true);
});

await check("未注册进 missing；服务缺失/冻结对象进 failed", () => {
  assert.deepEqual(markConcurrencySafe(makeTools({}), ["glob"]).missing, ["glob"]);
  assert.equal(markConcurrencySafe(undefined, ["glob"]).failed.length, 1);
  const frozen = { glob: Object.freeze({ name: "glob" }) };
  assert.equal(markConcurrencySafe(makeTools(frozen), ["glob"]).failed.length, 1);
});

await check("unmark 撤掉标记", () => {
  const defs = { glob: { name: "glob" } };
  markConcurrencySafe(makeTools(defs), ["glob"]);
  unmarkConcurrencySafe(makeTools(defs), ["glob"]);
  assert.equal(defs.glob.isConcurrencySafe, undefined);
});

await check("parseTargets：数组 / 逗号串 / 默认", () => {
  assert.deepEqual(__internals.parseTargets(["a", "b"]), ["a", "b"]);
  assert.deepEqual(__internals.parseTargets("glob, grep"), ["glob", "grep"]);
  assert.deepEqual(__internals.parseTargets(undefined), ["glob", "grep"]);
});

await check("install：全局 + 会话作用域都标记，并打出调度器判据", async () => {
  const globalDefs = { glob: { name: "glob" }, grep: { name: "grep" } };
  const agent = { id: "s1" };
  const scoped = { s1: { glob: { name: "glob" }, grep: { name: "grep" } } };
  await quiet(async (logs) => {
    let disposer = null;
    const ctx = {
      inject(names, fn) { assert.deepEqual(names, ["tools", "agents"]); fn({ tools: makeTools(globalDefs, scoped), agents: { list: () => [agent] } }); },
      effect(factory) { disposer = factory(); }
    };
    const r = installToolConcurrency(ctx, {});
    assert.equal(r.installed, true);
    assert.equal(globalDefs.glob.isConcurrencySafe({ pattern: "*" }), true);
    assert.equal(scoped.s1.glob.isConcurrencySafe({ pattern: "*" }), true, "会话作用域应被标记");
    assert.ok(logs.some((l) => l.includes("已标记 glob,grep")), "应打印已标记：" + logs.join(" | "));
    assert.ok(logs.some((l) => l.includes("调度器判据") && l.includes("glob=true")), "应打印判据：" + logs.join(" | "));
    disposer();
    assert.equal(globalDefs.glob.isConcurrencySafe, undefined, "卸载应撤销全局标记");
    assert.equal(scoped.s1.glob.isConcurrencySafe, undefined, "卸载应撤销会话标记");
  });
});

await check("install：DSH_FLASH_PRESETS_CONCURRENCY=0 不动作", async () => {
  process.env.DSH_FLASH_PRESETS_CONCURRENCY = "0";
  try {
    await quiet(async (logs) => {
      const r = installToolConcurrency({ inject() {}, effect() {} }, {});
      assert.equal(r.installed, false);
      assert.ok(logs.some((l) => l.includes("未启用")));
    });
  } finally { delete process.env.DSH_FLASH_PRESETS_CONCURRENCY; }
});

await check("install：工具/会话晚到 → 定时扫描补上", async () => {
  const globalDefs = {};
  const agent = { id: "late" };
  const scoped = {};
  await quiet(async () => {
    let disposer = null;
    const ctx = {
      inject(names, fn) { fn({ tools: makeTools(globalDefs, scoped), agents: { list: () => [agent] } }); },
      effect(factory) { disposer = factory(); }
    };
    installToolConcurrency(ctx, { sweepMs: 600 });
    globalDefs.glob = { name: "glob" };
    scoped.late = { grep: { name: "grep" } };
    await new Promise((resolve) => setTimeout(resolve, 1400));
    assert.equal(typeof globalDefs.glob.isConcurrencySafe, "function", "晚到的全局工具应被补上");
    assert.equal(typeof scoped.late.grep.isConcurrencySafe, "function", "晚到的会话工具应被补上");
    if (disposer) disposer();
  });
});

await check("executable 钩子：决策点即时标记（不依赖扫描）", async () => {
  const defs = { grep: { name: "grep" }, read: { name: "read" } };
  const tools = {
    get(name, scope) { return scope === undefined ? defs[name] : undefined; },
    executable(name) { return defs[name]; }
  };
  await quiet(async () => {
    let disposer = null;
    const ctx = { inject(names, fn) { fn({ tools, agents: { list: () => [] } }); }, effect(factory) { disposer = factory(); } };
    installToolConcurrency(ctx, { sweepMs: 600000 });
    const def = tools.executable("grep");
    assert.equal(typeof def.isConcurrencySafe, "function", "决策点取定义时就该带上标记");
    assert.equal(def.isConcurrencySafe({ pattern: "*" }), true);
    assert.equal(tools.executable("read").isConcurrencySafe, undefined, "非目标工具不受影响");
    disposer();
    assert.equal(defs.grep.isConcurrencySafe, undefined, "卸载应撤掉勾子上打的标记");
  });
});

await check("日志随作用域增长：每个新会话各一条，不刷屏", async () => {
  const globalDefs = { glob: { name: "glob" } };
  const agentA = { id: "a" };
  const agentB = { id: "b" };
  const scoped = { a: { glob: { name: "glob" } }, b: { glob: { name: "glob" } } };
  const list = [agentA];
  await quiet(async (logs) => {
    let disposer = null;
    const ctx = {
      inject(names, fn) { fn({ tools: makeTools(globalDefs, scoped), agents: { list: () => list } }); },
      effect(factory) { disposer = factory(); }
    };
    installToolConcurrency(ctx, { sweepMs: 300 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    list.push(agentB);
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(scoped.b.glob.isConcurrencySafe({ pattern: "*" }), true, "新会话的作用域应被标记");
    const lines = logs.filter((l) => l.includes("已标记 glob"));
    assert.ok(lines.length >= 2, "应至少两条：" + logs.join(" | "));
    assert.ok(lines[lines.length - 1].includes("+ 2 个会话作用域"), "最后一条应显示 2 个作用域：" + lines.join(" | "));
    if (disposer) disposer();
  });
});

console.log("\ntool-concurrency: passed " + passed + ", failed " + failed);
process.exit(failed === 0 ? 0 : 1);
