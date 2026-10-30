
// 移除人工审批后的冒烟：设置 API / 提示词 / 阶段 / 无审批钩子
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
const tmp = "/tmp/pmo-smoke";
rmSync(tmp, { recursive: true, force: true });
mkdirSync(join(tmp, "plan-mode-ui"), { recursive: true });
// 故意留一条带 gate 的旧 state.json：升级后必须能正常读（忽略未知字段）
writeFileSync(join(tmp, "plan-mode-ui", "state.json"), JSON.stringify({
  default: { tier: "full", scope: "auto", max: false, gate: "plan" },
  sessions: { "sid-x": { tier: "light", gate: "plan", pinned: true } },
  updatedAt: null
}));
process.env.DSH_HOME = tmp;
const mod = await import(new URL("../lib/index.js", import.meta.url).href);
const handlers = new Map();
let stateHandler = null, sectionSpec = null;
mod.default.apply({
  effect(fn) { return fn(); },
  on(ev, cb) { handlers.set(ev, cb); },
  webServer: { register({ handler }) { stateHandler = handler; return () => {}; } },
  systemPrompt: { section(s) { sectionSpec = s; return {}; }, getSectionOrder() { return 500; } },
  get() { return null; }
});
const rows = [];
const check = (n, c, e) => rows.push({ n, pass: !!c, e: e === undefined ? "" : String(e).slice(0, 80) });
function call(method, url, body) {
  let out = "";
  const res = { headersSent: false, setHeader() {}, writeHead() {}, write(s) { out += s; }, end(s) { if (s) out += s; } };
  const ls = {};
  const req = { method, url, headers: { host: "127.0.0.1:3081", "content-type": "application/json", "sec-fetch-site": "same-origin", "x-plan-mode-client": "1" },
    on(ev, cb) { (ls[ev] || (ls[ev] = [])).push(cb); return req; }, resume() {} };
  if (body !== undefined) setTimeout(() => { for (const cb of ls.data || []) cb(Buffer.from(body)); for (const cb of ls.end || []) cb(); }, 0);
  return Promise.resolve(stateHandler(req, res)).then(() => (out === "" ? null : JSON.parse(out)));
}
// 1) 旧 state.json 能读，且 gate 字段被丢弃
const st = await call("GET", "/api/plan-mode/state?session=sid-x");
check("1 旧 state.json 可读（tier=light 覆盖生效）", st && st.tier === "light", st && st.tier);
check("2 响应里不再有 gate/gateActive", st && st.gate === undefined && st.gateActive === undefined);
check("3 default 里不再持久化 gate", st && st.settings && st.settings.default && st.settings.default.gate === undefined, JSON.stringify(st && st.settings && st.settings.default));
// 4) 写设置：tier/scope/max 仍可改，gate 被忽略
const post = await call("POST", "/api/plan-mode/state?session=sid-x", JSON.stringify({ tier: "full", gate: "plan" }));
check("4 POST tier 生效", post && post.tier === "full", post && post.tier);
check("5 POST 的 gate 被忽略且不报错", post && post.ok === true && post.gate === undefined);
// 6) 不再注册审批相关钩子
check("6 未注册 tools/pre-execute", handlers.has("tools/pre-execute") === false);
check("7 未注册 tools/post-execute", handlers.has("tools/post-execute") === false);
// 8) 提示词：不再出现 GATE 段，但规划协议仍在
const session = { id: "sid-x" };
handlers.get("session/event")(session, { type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: "加个导出按钮" }], turn: 1 });
handlers.get("session/event")(session, { type: "turn/start", turn: 1 });
const text = sectionSpec.text({ agent: { session } });
check("8 提示词无 GATE 段", typeof text === "string" && text.indexOf("GATE (gate=plan)") === -1);
check("9 提示词仍含 phase=planning", typeof text === "string" && text.indexOf("phase=planning") !== -1, (text || "").slice(0, 40));
check("10 提示词仍含 P0 协议", typeof text === "string" && text.indexOf("P0-EXEC.yml") !== -1);
// 11) 新回合会重置阶段记录（turn/start 仍工作）
const st2 = await call("GET", "/api/plan-mode/state?session=sid-x");
check("11 阶段 API 仍可用", st2 && st2.ok === true && typeof st2.phase === "string", st2 && st2.phase);
const pass = rows.filter((r) => r.pass).length;
console.log("冒烟：" + pass + "/" + rows.length);
for (const r of rows) console.log((r.pass ? "PASS " : "FAIL ") + r.n + (r.e ? "  [" + r.e + "]" : ""));
process.exit(pass === rows.length ? 0 : 1);
