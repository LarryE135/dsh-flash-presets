// 四态指示器：off / armed / planning / executing —— 动画的唯一依据
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";

const HERE = dirname(fileURLToPath(import.meta.url));
let seq = 0;

async function boot(tier) {
  const home = mkdtempSync(join(tmpdir(), "pmui-ind-"));
  mkdirSync(join(home, "plan-mode-ui"), { recursive: true });
  writeFileSync(join(home, "plan-mode-ui", "state.json"), JSON.stringify({ version: 1, default: { tier, scope: "always", max: false }, sessions: {} }));
  process.env.DSH_HOME = home;
  const handlers = new Map();
  let route = null;
  const seen = [];
  const commands = { execute: (agent, line, attachments, signal) => { seen.push(line); return Promise.resolve({ commandId: "c", result: { kind: "success" } }); } };
  const { default: plugin } = await import("../lib/index.js?ind" + (++seq) + "-" + Date.now());
  const ctx = {
    get: (n) => (n === "commands" ? commands : undefined),
    on: (n, fn) => handlers.set(n, fn),
    inject: () => {}, effect: (fn) => { try { fn(); } catch (e) {} },
    webServer: { register: (spec) => { route = spec.handler; return () => {}; } },
    systemPrompt: { section: () => {}, getSectionOrder: () => 500 },
    logger: { warn() {}, info() {} }
  };
  plugin.apply(ctx);
  const session = { id: "ind-" + seq, delegationDepth: 0 };
  handlers.get("agent/created")?.({ agent: { session, steer() {}, inject() {} } });
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
  return { fire: (n, ...a) => handlers.get(n)?.(...a), session, state, post, seen };
}

const userMsg = (turn) => ({ type: "user/message", data: { turn, content: [{ type: "text", text: "继续" }], source: { kind: "user" } } });

// I1：off 档 → off
{
  const c = await boot("off");
  c.fire("session/event", c.session, { type: "turn/start", data: { turn: 2 } });
  c.fire("session/event", c.session, userMsg(2));
  const d = await c.state();
  if (d.indicator !== "off") throw new Error("I1 期望 off，实际 " + d.indicator);
  console.log("PASS I1 off 档 → off");
}

// I2：计划模式开着但回合已结束 → armed（当前错位场景）
{
  const c = await boot("light");
  c.fire("session/event", c.session, { type: "turn/start", data: { turn: 2 } });
  c.fire("session/event", c.session, userMsg(2));
  c.fire("session/event", c.session, { type: "turn/end", data: { turn: 2 } });
  const d = await c.state();
  if (d.native !== true) throw new Error("I2 前置：应仍为 native=true，实际 " + d.native);
  if (d.indicator !== "armed") throw new Error("I2 期望 armed，实际 " + d.indicator);
  console.log("PASS I2 已启用 + 空闲 → armed（不再空转书写动画）");
}

// I3：计划模式开着且回合进行中 → planning
{
  const c = await boot("light");
  c.fire("session/event", c.session, { type: "turn/start", data: { turn: 2 } });
  c.fire("session/event", c.session, userMsg(2));
  const d = await c.state();
  if (d.indicator !== "planning") throw new Error("I3 期望 planning，实际 " + d.indicator);
  console.log("PASS I3 已启用 + 回合进行中 → planning");
}

// I4：full 批准后（native 已 false）→ executing
{
  const c = await boot("full");
  c.fire("session/event", c.session, { type: "turn/start", data: { turn: 2 } });
  c.fire("session/event", c.session, userMsg(2));
  c.fire("session/event", c.session, { type: "plan/mode", data: { turn: 2, active: false } });
  const d = await c.state();
  if (d.native !== false || d.indicator !== "executing") throw new Error("I4 期望 false/executing，实际 " + d.native + "/" + d.indicator);
  console.log("PASS I4 批准后 native=false 但 indicator=executing（优先级正确）");
}

// I5/I6：客户端读取 indicator，且有旧版兜底；armed 是静止的
{
  let mod = null;
  globalThis.window = { __ModuleLoader__: { load: (m) => { mod = m; } } };
  await import("../lib/client.js?ind" + Date.now());
  const exp = mod.factory(() => ({}));
  const g = exp.__glyphPhase;
  if (g({ indicator: "armed", native: true, phase: "idle" }) !== "armed") throw new Error("I5 indicator 未被采纳");
  if (g({ native: true, phase: "idle" }) !== "planning") throw new Error("I5 旧服务端兜底失效");
  if (g({ phase: "executing" }) !== "executing") throw new Error("I5 phase 兜底失效");
  const css = readFileSync(join(HERE, "..", "lib", "client.js"), "utf8");
  const armedRules = css.split("\n").filter((l) => l.includes("data-phase='armed'"));
  if (armedRules.length < 2) throw new Error("I6 缺少 armed 的样式规则");
  if (armedRules.some((l) => l.includes("animation"))) throw new Error("I6 armed 不应有动画（应与 planning 区分）");
  // I12：静态区分 —— armed 必须有一眼可见的差异（60% 不透明度），否则截图里和 planning 无法区分
  if (!armedRules.some((l) => l.includes("opacity:.6"))) throw new Error("I12 armed 缺少不透明度区分（静态图会与 planning 混淆）");
  // I13：有状态时按钮必须带文字标签（官方胶囊被隐藏后，这是唯一可见的"我在计划模式里"）
  const txt = exp.__phaseText;
  if (txt("armed") !== "计划" || txt("planning") !== "计划中" || txt("executing") !== "执行中" || txt("planned") !== "已计划" || txt("idle") !== "") {
    throw new Error("I13 阶段标签映射不对：" + JSON.stringify([txt("armed"), txt("planning"), txt("executing"), txt("planned"), txt("idle")]));
  }
  if (!css.includes("[data-labelled='true']") || !css.includes(".pmo-lbl{")) throw new Error("I13 缺少标签胶囊的样式规则");
  console.log("PASS I5/I6/I12 客户端采纳 indicator、旧版兜底有效、armed 静止且 60% 不透明度（静态可辨）");
  console.log("PASS I13 有状态时按钮带文字标签（计划/计划中/执行中/已计划），idle 不带");
}

// I11：自检接口（window.__pmo / __pmoDebug）在无 DOM 环境安全，不抛错
{
  let mod2 = null;
  globalThis.window = { __ModuleLoader__: { load: (m) => { mod2 = m; } } };
  await import("../lib/client.js?pmo" + Date.now());
  const exp2 = mod2.factory(() => ({}));
  const d = exp2.__pmoDebug;
  if (!d || typeof d.why !== "function" || typeof d.anim !== "function" || typeof d.hud !== "function") {
    throw new Error("I11 缺少 __pmoDebug 自检接口");
  }
  if (typeof d.why() !== "string") throw new Error("I11 why() 未返回字符串");
  if (!Array.isArray(d.anim())) throw new Error("I11 anim() 未返回数组");
  if (d.hud(true) !== null) throw new Error("I11 无 DOM 时 hud(true) 应安全返回 null");
  console.log("PASS I11 自检接口在无 DOM 环境安全（why/anim/hud）");
}

// I7：light 档批准/自动执行后 —— 回合内显示执行，回合结束仍显示「已计划」（不能掉回默认色）
{
  const c = await boot("light");
  c.fire("session/event", c.session, { type: "turn/start", data: { turn: 2 } });
  c.fire("session/event", c.session, userMsg(2));
  c.fire("session/event", c.session, { type: "plan/mode", data: { turn: 2, active: false } });
  const during = await c.state();
  if (during.indicator !== "executing") throw new Error("I7 批准后回合内应为 executing，实际 " + during.indicator);
  c.fire("session/event", c.session, { type: "turn/end", data: { turn: 2 } });
  const after = await c.state();
  if (after.indicator !== "planned") throw new Error("I7 回合结束应保持 planned，实际 " + after.indicator);
  console.log("PASS I7 light 批准后：回合内 executing、回合结束 planned");
}

// I8：新回合开始清掉「已计划」，不会一直挂着
{
  const c = await boot("light");
  c.fire("session/event", c.session, { type: "turn/start", data: { turn: 2 } });
  c.fire("session/event", c.session, userMsg(2));
  c.fire("session/event", c.session, { type: "plan/mode", data: { turn: 2, active: false } });
  c.fire("session/event", c.session, { type: "turn/end", data: { turn: 2 } });
  if ((await c.state()).indicator !== "planned") throw new Error("I8 前置失败");
  c.fire("session/event", c.session, { type: "turn/start", data: { turn: 3 } });
  const d = await c.state();
  if (d.indicator === "planned") throw new Error("I8 新回合仍显示 planned（没清标记）");
  console.log("PASS I8 新回合清掉「已计划」标记（实际 " + d.indicator + "）");
}

// I9：planned 与 executing 一样是"完成态"，但静止无动画
{
  const css = readFileSync(join(HERE, "..", "lib", "client.js"), "utf8");
  const rules = css.split("\n").filter((l) => l.includes("data-phase='planned'"));
  if (rules.length < 3) throw new Error("I9 缺少 planned 的样式规则");
  if (rules.some((l) => l.includes("animation"))) throw new Error("I9 planned 不应有动画（与 executing 区分）");
  if (!controls(css)) throw new Error("I9 planned 缺少对勾显示规则");
  console.log("PASS I9 planned 静止（对勾+进度线，无动画）");
}

function controls(src) { return src.includes(".pmo-glyph[data-phase='planned'] .pmo-ck{opacity:1}"); }

// I10：档位切到「关闭」= 全关，立即退出原生计划模式（不必等下一个回合，按钮也不再并列）
{
  const c = await boot("light");
  c.fire("session/event", c.session, { type: "turn/start", data: { turn: 9 } });
  c.fire("session/event", c.session, userMsg(9));
  if ((await c.state()).native !== true) throw new Error("I10 前置：没桥接上");
  const r = await c.post({ tier: "off" });
  if (r.ok !== true || r.tier !== "off") throw new Error("I10 写入关闭档失败：" + JSON.stringify(r));
  await new Promise((res) => setTimeout(res, 20));
  if (!c.seen.includes("/plan off")) throw new Error("I10 切到关闭后没有立即退出原生计划模式，seen=" + JSON.stringify(c.seen));
  const d = await c.state();
  if (d.native !== false) throw new Error("I10 native 应为 false，实际 " + d.native);
  if (d.indicator === "armed" || d.indicator === "planning") throw new Error("I10 关闭后仍显示原生态：" + d.indicator);
  console.log("PASS I10 档位=关闭 → 立即退出原生计划模式（native=false，" + d.indicator + "）");
}
