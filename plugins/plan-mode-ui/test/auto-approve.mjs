// 自动批准：设置页开关 → 命中「计划评审」时直接回批准，其它一律退回人工
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

let seq = 0;
const NEXT = Symbol("next");

async function boot(tier, opts = {}) {
  const home = mkdtempSync(join(tmpdir(), "pmui-auto-"));
  mkdirSync(join(home, "plan-mode-ui"), { recursive: true });
  writeFileSync(join(home, "plan-mode-ui", "state.json"), JSON.stringify({
    version: 1,
    default: { tier, scope: "always", max: false, autoApprove: opts.autoApprove === true },
    sessions: {}
  }));
  process.env.DSH_HOME = home;
  const handlers = new Map();
  let route = null;
  const commands = { execute: () => Promise.resolve({ commandId: "c", result: { kind: "success" } }) };
  const { default: plugin } = await import("../lib/index.js?auto" + (++seq) + "-" + Date.now());
  const ctx = {
    get: (n) => (n === "commands" ? commands : undefined),
    on: (n, fn) => { handlers.set(n, fn); return () => {}; },
    inject: () => {}, effect: (fn) => { try { fn(); } catch (e) {} },
    webServer: { register: (spec) => { route = spec.handler; return () => {}; } },
    systemPrompt: { section: () => () => {}, getSectionOrder: () => 500 },
    logger: { warn() {}, info() {} }
  };
  plugin.apply(ctx);
  const session = { id: "auto-" + seq, delegationDepth: 0 };
  handlers.get("agent/created")?.({ agent: { session, steer() {}, inject() {} } });
  const listener = () => handlers.get("user-questions/request");
  const ask = (request) => {
    const l = listener();
    if (typeof l !== "function") throw new Error("没有注册 user-questions/request 监听器");
    return l(request, () => NEXT);
  };
  const state = () => new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = "GET";
    req.url = "/api/plan-mode/state?session=" + encodeURIComponent(session.id);
    req.headers = { host: "127.0.0.1:3081" };
    const res = { writeHead() {}, end(text) { resolve(JSON.parse(text)); } };
    route(req, res);
  });
  const post = (body) => new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = "POST";
    req.url = "/api/plan-mode/state?session=" + encodeURIComponent(session.id);
    req.headers = { host: "127.0.0.1:3081", "content-type": "application/json", "x-plan-mode-client": "1" };
    const res = { writeHead() {}, end(text) { resolve(JSON.parse(text)); } };
    route(req, res);
    req.emit("data", Buffer.from(JSON.stringify(body || {})));
    req.emit("end");
  });
  return { session, ask, state, post };
}

const review = (session, extra = {}) => ({
  questions: [{
    id: "plan-review",
    header: "Plan review",
    question: "Approve this plan and leave plan mode?",
    detail: "# 计划\n做点什么",
    options: [{ label: "Approve" }, { label: "Keep planning" }],
    intent: { kind: "plan-review", approve: "Approve", callId: "call-1" }
  }],
  agent: { session },
  signal: { aborted: false },
  ...extra
});

// A1：开 + light → 直接回批准
{
  const c = await boot("light", { autoApprove: true });
  const out = c.ask(review(c.session));
  if (out === NEXT) throw new Error("A1 开启自动批准却没有作答");
  if (out.answers.length !== 1 || out.answers[0].id !== "plan-review") throw new Error("A1 答案 id 不对：" + JSON.stringify(out));
  if (out.answers[0].selected.length !== 1 || out.answers[0].selected[0] !== "Approve") throw new Error("A1 选的不是批准：" + JSON.stringify(out));
  if (out.answers[0].custom !== undefined) throw new Error("A1 不应带 custom（会被当反馈）");
  console.log("PASS A1 开启自动批准 → 计划评审直接返回「Approve」");
}

// A2：关闭 → 交回人工
{
  const c = await boot("light", { autoApprove: false });
  if (c.ask(review(c.session)) !== NEXT) throw new Error("A2 关闭时不该作答");
  console.log("PASS A2 关闭自动批准 → 交回人工弹卡");
}

// A3：档位关闭 → 即使开关是 on 也不触发
{
  const c = await boot("off", { autoApprove: true });
  if (c.ask(review(c.session)) !== NEXT) throw new Error("A3 档位关闭时不该作答");
  const d = await c.state();
  if (!(d.debug.auto.skipped >= 1)) throw new Error("A3 没有记 skipped");
  console.log("PASS A3 档位=关闭 → 不触发（skipped=" + d.debug.auto.skipped + "）");
}

// A4：不是计划评审的问题 → 不替用户答
{
  const c = await boot("light", { autoApprove: true });
  const req = {
    questions: [{ id: "q1", question: "选哪个？", options: [{ label: "A" }, { label: "B" }] }],
    agent: { session: c.session }, signal: { aborted: false }
  };
  if (c.ask(req) !== NEXT) throw new Error("A4 越权回答了普通提问");
  console.log("PASS A4 只认计划评审 → 普通提问仍交回人工");
}

// A5：一次多个问题 → 不答（不替用户做别的决定）
{
  const c = await boot("light", { autoApprove: true });
  const one = review(c.session);
  const two = { ...one, questions: [one.questions[0], { id: "q2", question: "继续吗？", options: [{ label: "是" }] }] };
  if (c.ask(two) !== NEXT) throw new Error("A5 多问题请求被自动答了");
  console.log("PASS A5 请求含多个问题 → 交回人工");
}

// A6：已取消的请求 → 不答
{
  const c = await boot("light", { autoApprove: true });
  if (c.ask(review(c.session, { signal: { aborted: true } })) !== NEXT) throw new Error("A6 已取消的请求仍被作答");
  console.log("PASS A6 signal 已取消 → 交回人工");
}

// A7：状态读写（全局写、会话 reset 回落）
{
  const c = await boot("light", { autoApprove: false });
  if ((await c.state()).autoApprove !== false) throw new Error("A7 初始应为 false");
  await c.post({ autoApprove: true });
  if ((await c.state()).autoApprove !== true) throw new Error("A7 写入后应为 true");
  await c.post({ reset: true });
  if ((await c.state()).autoApprove !== false) throw new Error("A7 reset 后应回落到默认 false");
  console.log("PASS A7 autoApprove 可写、可 reset 回落");
}

// A8：子代理会话 → 不答（与 planning 拦截一致，只针对主对话）
{
  const c = await boot("light", { autoApprove: true });
  const sub = { id: "auto-sub-" + seq, delegationDepth: 1 };
  if (c.ask(review(sub)) !== NEXT) throw new Error("A8 子代理会话被自动批准");
  console.log("PASS A8 子代理会话 → 交回人工");
}
