// 自动批准「fire」链路：只在真的批准时计数，客户端按 a/b 交替重放冲击帧
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
let seq = 0;
const NEXT = Symbol("next");

async function boot() {
  const home = mkdtempSync(join(tmpdir(), "pmui-fire-"));
  mkdirSync(join(home, "plan-mode-ui"), { recursive: true });
  writeFileSync(join(home, "plan-mode-ui", "state.json"), JSON.stringify({
    version: 1,
    default: { tier: "full", scope: "always", max: false, autoApprove: true },
    sessions: {}
  }));
  process.env.DSH_HOME = home;
  const handlers = new Map();
  let route = null;
  const { default: plugin } = await import("../lib/index.js?fire" + (++seq) + "-" + Date.now());
  const ctx = {
    get: () => undefined,
    on: (n, fn) => { handlers.set(n, fn); return () => {}; },
    inject: () => {}, effect: (fn) => { try { fn(); } catch (e) {} },
    webServer: { register: (spec) => { if (String(spec.path).endsWith("/state")) route = spec.handler; return () => {}; } },
    systemPrompt: { section: () => () => {}, getSectionOrder: () => 500 },
    logger: { warn() {}, info() {} }
  };
  plugin.apply(ctx);
  const session = { id: "fire-" + seq, delegationDepth: 0 };
  handlers.get("agent/created")?.({ agent: { session, steer() {}, inject() {} } });
  const state = () => new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = "GET";
    req.url = "/api/plan-mode/state?session=" + encodeURIComponent(session.id);
    req.headers = { host: "127.0.0.1:3081" };
    const res = { writeHead() {}, end(text) { resolve(JSON.parse(text)); } };
    route(req, res);
  });
  const planReview = () => ({
    agent: { session },
    questions: [{ id: "plan-review", question: "批准这份计划吗？", intent: { kind: "plan-review", approve: "approve" } }]
  });
  const ask = (request) => {
    const l = handlers.get("user-questions/request");
    return l(request, () => NEXT);
  };
  return { state, ask, planReview, session };
}

test("真批准一次 → autoFires 加 1", async () => {
  const { state, ask, planReview } = await boot();
  assert.equal((await state()).autoFires, 0);
  const out = await ask(planReview());
  assert.notEqual(out, NEXT, "命中的评审应当被直接批准，而不是退回人工");
  assert.equal((await state()).autoFires, 1);
});

test("连续批准 → 计数累加（客户端据此 a/b 交替）", async () => {
  const { state, ask, planReview } = await boot();
  await ask(planReview());
  await ask(planReview());
  await ask(planReview());
  assert.equal((await state()).autoFires, 3);
});

test("不走批准路径（非计划评审）→ 计数不动", async () => {
  const { state, ask, session } = await boot();
  const out = await ask({ agent: { session }, questions: [{ id: "other", question: "x" }] });
  assert.equal(out, NEXT);
  assert.equal((await state()).autoFires, 0);
});

test("客户端把计数映射成 data-fire 的 a/b 交替，且首帧不播放", () => {
  const cli = readFileSync(join(HERE, "..", "lib", "client.js"), "utf8");
  assert.ok(cli.includes('"data-fire": s.fire || ""'), "图标要把 fire 属性接出来");
  assert.ok(cli.includes("S.fire = (firesNow % 2 === 1) ? \"a\" : \"b\""), "奇数帧用 a、偶数帧用 b（属性变化才会重放动画）");
  assert.ok(cli.includes("if (!S.firesReady)"), "首帧只记录计数，不播放（刷新页面不该脉冲一次）");
  assert.ok(cli.includes("if (!autoOn) S.fire = \"\""), "关掉自动批准要把 fire 清空");
});
