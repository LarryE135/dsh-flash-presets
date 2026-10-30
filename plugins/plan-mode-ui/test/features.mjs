
// v0.4.0 特色测试：两阶段同回合推进 / 计划落地与纠偏 / 阶段化提示词 / scope 语义 / 无人工审批
import { mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
const tmpHome = "/tmp/pmo-feat-home";
const tmpCwd = "/tmp/pmo-feat-cwd";
rmSync(tmpHome, { recursive: true, force: true });
rmSync(tmpCwd, { recursive: true, force: true });
mkdirSync(join(tmpHome, "plan-mode-ui"), { recursive: true });
mkdirSync(tmpCwd, { recursive: true });
writeFileSync(join(tmpHome, "plan-mode-ui", "state.json"), JSON.stringify({
  default: { tier: "full", scope: "always", max: false }, sessions: {}, updatedAt: null
}));
process.env.DSH_HOME = tmpHome;

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
const emit = (ev, session) => handlers.get("session/event")(session, ev);

const rows = [];
const check = (n, c, e) => rows.push({ n, pass: !!c, e: e === undefined ? "" : String(e).replace(/\s+/g, " ").slice(0, 70) });
function api(method, path, body, headers) {
  let out = "";
  const res = { headersSent: false, setHeader() {}, writeHead() {}, write(s) { out += s; }, end(s) { if (s) out += s; } };
  const ls = {};
  const h = Object.assign({ host: "127.0.0.1:3081", "content-type": "application/json", "sec-fetch-site": "same-origin", "x-plan-mode-client": "1" }, headers || {});
  const req = { method, url: path, headers: h, on(ev, cb) { (ls[ev] || (ls[ev] = [])).push(cb); return req; }, resume() {} };
  if (body !== undefined) setTimeout(() => { for (const cb of ls.data || []) cb(Buffer.from(body)); for (const cb of ls.end || []) cb(); }, 0);
  return Promise.resolve(stateHandler(req, res)).then(() => (out === "" ? null : JSON.parse(out)));
}
const state = (sid) => api("GET", "/api/plan-mode/state?session=" + sid);
const mkSession = (id, extra) => Object.assign({ id: id, cwd: tmpCwd }, extra || {});
const steers = [];
function mkAgent(session) {
  return { session, steer(msg) { steers.push(msg && msg.content && msg.content[0] ? String(msg.content[0].text) : String(msg)); } };
}
const STOP = handlers.get("agent/turn-stopping");
function planFile(sid) {
  const p = join(tmpCwd, ".plan-mode");
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "plan.md"), "goal\nsteps\nchecks\n");
  return p;
}
function clearPlan() { rmSync(join(tmpCwd, ".plan-mode"), { recursive: true, force: true }); }

/* ---------- A. 状态 API ---------- */
{
  const s1 = "api-1";
  const st = await state(s1);
  check("A1 GET 返回 tier/scope/max 且无 gate 字段", st && st.tier === "full" && !("gate" in st), JSON.stringify(st && { tier: st.tier, scope: st.scope }));
  const p1 = await api("POST", "/api/plan-mode/state?session=" + s1, JSON.stringify({ tier: "light", max: true }));
  check("A2 POST 生效（tier=light + max）", p1 && p1.tier === "light" && p1.max === true);
  const bad = await api("POST", "/api/plan-mode/state?session=" + s1, JSON.stringify({ tier: "nope" }));
  check("A3 非法 tier 被拒 400", bad && bad.ok === false, bad && bad.message);
  const noHdr = await api("POST", "/api/plan-mode/state?session=" + s1, JSON.stringify({ tier: "full" }), { "x-plan-mode-client": "" });
  check("A4 缺 x-plan-mode-client 的 POST 被拒 403", noHdr && noHdr.ok === false && /cross-origin/.test(String(noHdr.message)), noHdr && noHdr.message);
  const wrongMethod = await api("PUT", "/api/plan-mode/state", "{}");
  check("A5 错误方法 405", wrongMethod && wrongMethod.ok === false, wrongMethod && wrongMethod.message);
  await api("POST", "/api/plan-mode/state?session=" + s1, JSON.stringify({ tier: "full", max: false }));
}

/* ---------- B. 两阶段：规划 → 同一回合内推进到执行 ---------- */
{
  const sid = "two-1";
  const session = mkSession(sid);
  const agent = mkAgent(session);
  handlers.get("agent/created")({ agent });
  emit({ type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: "给面板加导出按钮" }], turn: 1 }, session);
  emit({ type: "turn/start", turn: 1 }, session);
  const st = await state(sid);
  check("B1 回合开始即进入 planning", st && st.phase === "planning", st && st.phase);

  // 规划期先动手、且没有计划文件 → 立刻纠偏（PHASE_PLAN_FIRST）
  clearPlan();
  steers.length = 0;
  emit({ type: "tool/call", name: "write", turn: 1 }, session);
  check("B2 规划期先动手被纠偏（PLAN FIRST）", steers.length === 1 && steers[0].indexOf("PLAN FIRST") === 0, steers[0] && steers[0].slice(0, 24));

  // 计划落地后不再纠偏
  planFile(sid);
  emit({ type: "turn/start", turn: 1 }, session);   // 同回合重复 start 不重置
  emit({ type: "tool/call", name: "edit", turn: 1 }, session);
  check("B3 计划已落地则不再纠偏", steers.length === 1, steers.length);

  // 回合收尾 → 同一回合内投递 PHASE 2，阶段切到 executing
  await STOP({ agent, turn: 1, signal: { aborted: false } });
  check("B4 收尾时注入 PHASE 2", steers.length === 2 && steers[1].indexOf("PHASE 2") === 0, steers[1] && steers[1].slice(0, 20));
  const st2 = await state(sid);
  check("B5 阶段切到 executing", st2 && st2.phase === "executing", st2 && st2.phase);
  await STOP({ agent, turn: 1, signal: { aborted: false } });
  check("B6 同回合只续跑一次（不重复注入）", steers.length === 2, steers.length);
  emit({ type: "turn/end", turn: 1 }, session);
  const st3 = await state(sid);
  check("B7 回合结束后回到 idle", st3 && st3.phase === "idle", st3 && st3.phase);
}

/* ---------- C. 不该硬续的情况 ---------- */
{
  const mk = (sid) => { const s = mkSession(sid); handlers.get("agent/created")({ agent: mkAgent(s) }); return s; };
  // 纯问答：没有工具调用、没有计划文件
  const qa = mk("qa-1");
  emit({ type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: "这个插件是干什么的？" }], turn: 1 }, qa);
  emit({ type: "turn/start", turn: 1 }, qa);
  clearPlan();
  steers.length = 0;
  await STOP({ agent: mkAgent(qa), turn: 1, signal: { aborted: false } });
  check("C1 纯问答不硬续执行", steers.length === 0, steers.length);

  // 模型在提问（末句是问号）
  const ask = mk("ask-1");
  emit({ type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: "照这个改" }], turn: 1 }, ask);
  emit({ type: "turn/start", turn: 1 }, ask);
  planFile("ask-1");
  emit({ type: "assistant/message", message: { content: [{ type: "text", text: "按这个计划开始吗？" }] }, turn: 1 }, ask);
  steers.length = 0;
  await STOP({ agent: mkAgent(ask), turn: 1, signal: { aborted: false } });
  check("C2 末句是问号时不续跑", steers.length === 0, steers.length);

  // 用户取消
  const ab = mk("abort-1");
  emit({ type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: "照这个改" }], turn: 1 }, ab);
  emit({ type: "turn/start", turn: 1 }, ab);
  planFile("abort-1");
  emit({ type: "tool/call", name: "read", turn: 1 }, ab);
  steers.length = 0;
  await STOP({ agent: mkAgent(ab), turn: 1, signal: { aborted: true } });
  check("C3 signal.aborted 时不续跑", steers.length === 0, steers.length);

  // 规划期动了手、但没有计划文件，且没有中途纠偏的机会 → 收尾时先要计划
  const missing = mkSession("miss-1");
  emit({ type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: "改一下渲染" }], turn: 1 }, missing);
  emit({ type: "turn/start", turn: 1 }, missing);
  clearPlan();
  emit({ type: "tool/call", name: "write", turn: 1 }, missing);
  steers.length = 0;
  await STOP({ agent: mkAgent(missing), turn: 1, signal: { aborted: false } });
  check("C4 缺计划时先索要计划（PLAN NOT FOUND）", steers.length === 1 && steers[0].indexOf("PLAN NOT FOUND") === 0, steers[0] && steers[0].slice(0, 20));
}

/* ---------- C2. 计划交付后没有停步 → 收尾不再催（v0.4.1） ---------- */
{
  // 连做了 2 次工具调用：已经在执行，turn-stopping 不该再注入 PHASE 2
  const busy = mkSession("busy-1");
  handlers.get("agent/created")({ agent: mkAgent(busy) });
  emit({ type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: "重建整个建筑群，规模扩大十倍" }], turn: 1 }, busy);
  emit({ type: "turn/start", turn: 1 }, busy);
  planFile("busy-1");
  emit({ type: "tool/call", name: "run_code", turn: 1 }, busy);
  emit({ type: "tool/call", name: "run_code", turn: 1 }, busy);
  steers.length = 0;
  await STOP({ agent: mkAgent(busy), turn: 1, signal: { aborted: false } });
  const st = await state("busy-1");
  check("C5 计划后仍在干活 → 不再注入 PHASE 2", steers.length === 0, steers.length);
  check("C6 但阶段照常切到 executing", st && st.phase === "executing", st && st.phase);

  // 计划交付后只调了 1 次工具就停 → 仍然要续跑（别把正常流程也掐掉）
  const light = mkSession("busy-2");
  handlers.get("agent/created")({ agent: mkAgent(light) });
  emit({ type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: "给面板加个按钮" }], turn: 1 }, light);
  emit({ type: "turn/start", turn: 1 }, light);
  planFile("busy-2");
  emit({ type: "tool/call", name: "read", turn: 1 }, light);
  steers.length = 0;
  await STOP({ agent: mkAgent(light), turn: 1, signal: { aborted: false } });
  check("C7 计划后只做一步 → 仍然注入 PHASE 2", steers.length === 1 && steers[0].indexOf("PHASE 2") === 0, steers.length);
}

/* ---------- D. 阶段化提示词 ---------- */
{
  const sid = "prompt-1";
  const session = mkSession(sid);
  const text = () => String(sectionSpec.text({ agent: { session } }) || "");
  await api("POST", "/api/plan-mode/state?session=" + sid, JSON.stringify({ tier: "full" }));
  emit({ type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: "写个导出" }], turn: 1 }, session);
  emit({ type: "turn/start", turn: 1 }, session);
  const planning = text();
  check("D1 planning 段含 PHASE 1", planning.indexOf("PHASE 1") >= 0);
  check("D2 planning 段要求先写 .plan-mode/plan.md", planning.indexOf(".plan-mode/plan.md") >= 0);
  check("D3 planning 段收尾句是“只出计划”", /produce only the plan/i.test(planning));
  check("D4 提示词不含人工审批字样", planning.indexOf("GATE") === -1 && planning.indexOf("plan-approve") === -1);

  handlers.get("session/event")(session, { type: "tool/call", name: "read", turn: 1 });
  planFile(sid);
  await STOP({ agent: mkAgent(session), turn: 1, signal: { aborted: false } });
  const executing = text();
  check("D5 executing 段含 PHASE 2", executing.indexOf("PHASE 2") >= 0);
  check("D6 executing 段要求回报实测值", /report the measured numbers/i.test(executing));

  // tier=off → 不注入
  const offSid = "prompt-off";
  const offSession = mkSession(offSid);
  await api("POST", "/api/plan-mode/state?session=" + offSid, JSON.stringify({ tier: "off" }));
  check("D7 tier=off 不注入任何协议", String(sectionSpec.text({ agent: { session: offSession } }) || "") === "");
  await api("POST", "/api/plan-mode/state?session=" + offSid, JSON.stringify({ tier: "off", max: true }));
  const maxText = String(sectionSpec.text({ agent: { session: offSession } }) || "");
  check("D8 关档 + Max 仍注入 MAX 行", maxText.indexOf("MAX MODE") >= 0, maxText.slice(0, 24));

  // 子代理不注入
  const subSession = mkSession("sub-1", { delegationDepth: 1 });
  check("D9 子代理会话不注入", String(sectionSpec.text({ agent: { session: subSession } }) || "") === "");
  await api("POST", "/api/plan-mode/state?session=prompt-off", JSON.stringify({ max: false }));
}

/* ---------- E. scope 语义 ---------- */
{
  const run = async (sid, scope, turn, msg) => {
    await api("POST", "/api/plan-mode/state?session=" + sid, JSON.stringify({ tier: "full", scope: scope }));
    const s = mkSession(sid);
    emit({ type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: msg }], turn: turn }, s);
    emit({ type: "turn/start", turn: turn }, s);
    const st = await state(sid);
    return st && st.phase;
  };
  check("E1 scope=always 第 2 回合仍规划", (await run("sc-1", "always", 2, "继续")) === "planning");
  check("E2 scope=first 第 2 回合不规划", (await run("sc-2", "first", 2, "继续")) !== "planning");
  check("E3 scope=auto 第 2 回合短指令不规划", (await run("sc-3", "auto", 2, "继续")) !== "planning");
  check("E4 scope=auto 第 2 回合改方案措辞会重规划", (await run("sc-4", "auto", 2, "这个不行，重构一下")) === "planning");
  check("E5 scope=auto 第 2 回合长指令会重规划", (await run("sc-5", "auto", 2, "请把导出功能改成支持 CSV 和 Excel 两种格式，并补上对应的验收用例")) === "planning");
  check("E6 scope=auto 第 2 回合“扩大到十倍”这类量级词也重规划", (await run("sc-6", "auto", 2, "提高精度和规模，至少扩大到当前的10倍以上")) === "planning");
  check("E7 scope=auto 第 2 回合闲聊短句仍不重规划", (await run("sc-7", "auto", 2, "谢谢")) !== "planning");
}

/* ---------- F. 计划文件判定 ---------- */
{
  clearPlan();
  const sid = "plan-1";
  const s = mkSession(sid);
  handlers.get("agent/created")({ agent: mkAgent(s) });
  emit({ type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: "实现导出" }], turn: 1 }, s);
  emit({ type: "turn/start", turn: 1 }, s);
  steers.length = 0;
  emit({ type: "tool/call", name: "write", turn: 1 }, s);
  check("F1 没有计划文件时动手 → 纠偏", steers.length === 1);
  emit({ type: "tool/call", name: "edit", turn: 1 }, s);
  check("F1b 纠偏只发一次（不刷屏）", steers.length === 1, steers.length);
  // 根目录 P0-EXEC.yml 不算计划（防项目自带同名文件放空）
  writeFileSync(join(tmpCwd, "P0-EXEC.yml"), "version: 1\n");
  steers.length = 0;
  const s2 = mkSession("plan-2");
  handlers.get("agent/created")({ agent: mkAgent(s2) });
  emit({ type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: "实现导出" }], turn: 1 }, s2);
  emit({ type: "turn/start", turn: 1 }, s2);
  emit({ type: "tool/call", name: "write", turn: 1 }, s2);
  check("F2 根目录 P0-EXEC.yml 不算计划 → 仍纠偏", steers.length === 1);
  // .plan-mode/ 下任意 md/yml 算计划
  clearPlan();
  mkdirSync(join(tmpCwd, ".plan-mode"), { recursive: true });
  writeFileSync(join(tmpCwd, ".plan-mode", "EVIDENCE.md"), "facts\n");
  steers.length = 0;
  const s3 = mkSession("plan-3");
  handlers.get("agent/created")({ agent: mkAgent(s3) });
  emit({ type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: "实现导出" }], turn: 1 }, s3);
  emit({ type: "turn/start", turn: 1 }, s3);
  emit({ type: "tool/call", name: "write", turn: 1 }, s3);
  check("F3 .plan-mode/EVIDENCE.md 也算计划 → 不纠偏", steers.length === 0, steers.length);
  rmSync(join(tmpCwd, "P0-EXEC.yml"), { force: true });
  clearPlan();
}

/* ---------- G. 无人工审批残留 ---------- */
{
  check("G1 不注册 tools/pre-execute", handlers.has("tools/pre-execute") === false);
  check("G2 不注册 tools/post-execute", handlers.has("tools/post-execute") === false);
  const st = await state("api-1");
  check("G3 状态里没有 gate/gateActive", st && !("gate" in st) && !("gateActive" in st));
}

const pass = rows.filter((r) => r.pass).length;
console.log("特征测试：" + pass + "/" + rows.length);
for (const r of rows) console.log((r.pass ? "PASS " : "FAIL ") + r.n + (r.e ? "  [" + r.e + "]" : ""));
process.exit(pass === rows.length ? 0 : 1);