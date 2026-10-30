// 面板绑定对话、设置页管全局：取消「仅本会话」后的语义
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";

const HERE = dirname(fileURLToPath(import.meta.url));
let seq = 0;

async function boot(globalTier) {
  const home = mkdtempSync(join(tmpdir(), "pmui-scope-"));
  mkdirSync(join(home, "plan-mode-ui"), { recursive: true });
  writeFileSync(join(home, "plan-mode-ui", "state.json"), JSON.stringify({ version: 1, default: { tier: globalTier, scope: "always", max: false }, sessions: {} }));
  process.env.DSH_HOME = home;
  const handlers = new Map();
  let route = null;
  const { default: plugin } = await import("../lib/index.js?scope" + (++seq) + "-" + Date.now());
  const ctx = {
    get: () => undefined,
    on: (n, fn) => handlers.set(n, fn),
    inject: () => {}, effect: (fn) => { try { fn(); } catch (e) {} },
    webServer: { register: (spec) => { route = spec.handler; return () => {}; } },
    systemPrompt: { section: () => {}, getSectionOrder: () => 500 },
    logger: { warn() {}, info() {} }
  };
  plugin.apply(ctx);
  const call = (sid, method, body) => new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = "/api/plan-mode/state" + (sid === null ? "" : "?session=" + encodeURIComponent(sid));
    req.headers = { host: "127.0.0.1:3081", "content-type": "application/json", "x-plan-mode-client": "1" };
    const res = { writeHead() {}, end(text) { resolve(JSON.parse(text)); } };
    route(req, res);
    if (method === "POST") { req.emit("data", Buffer.from(JSON.stringify(body || {}))); req.emit("end"); }
  });
  return { get: (sid) => call(sid, "GET"), post: (sid, body) => call(sid, "POST", body) };
}

// P1：面板写会话 = 只影响这个对话
{
  const c = await boot("light");
  const before = await c.get("A");
  if (before.tier !== "light" || before.settings.source !== "default") throw new Error("P1 前置失败：" + JSON.stringify(before.settings));
  await c.post("A", { tier: "full" });
  const a = await c.get("A");
  const b = await c.get("B");
  if (a.tier !== "full" || a.settings.source !== "session") throw new Error("P1 会话 A 未生效：" + a.tier + "/" + a.settings.source);
  if (b.tier !== "light" || b.settings.source !== "default") throw new Error("P1 会话 B 被牵连：" + b.tier + "/" + b.settings.source);
  console.log("PASS P1 面板写会话：A=full/session，B 仍 light/default");
}

// P2：设置页写全局 → 已个性化的会话不受影响，其余跟随
{
  const c = await boot("light");
  await c.post("A", { tier: "full" });
  await c.post(null, { tier: "off" });
  const a = await c.get("A");
  const b = await c.get("B");
  if (a.tier !== "full") throw new Error("P2 个性化会话被全局覆盖：" + a.tier);
  if (b.tier !== "off") throw new Error("P2 未个性化的会话没跟随全局：" + b.tier);
  console.log("PASS P2 设置页写全局：A 保持 full，B 跟随变 off");
}

// P3：恢复全局默认 → 删掉会话行、回到跟随
{
  const c = await boot("light");
  await c.post("A", { tier: "full" });
  const r = await c.post("A", { reset: true });
  if (r.ok !== true) throw new Error("P3 reset 响应异常：" + JSON.stringify(r));
  const a = await c.get("A");
  if (a.tier !== "light" || a.settings.source !== "default") throw new Error("P3 reset 后仍为：" + a.tier + "/" + a.settings.source);
  const again = await c.post("A", { reset: true });   // 幂等
  if (again.ok !== true) throw new Error("P3 reset 不幂等");
  console.log("PASS P3 reset 回到跟随全局（且幂等）");
}

// P4：pin 字段已退役但被忽略（旧缓存客户端不报错）
{
  const c = await boot("light");
  await c.post("A", { tier: "full", pin: true });          // 旧客户端写法
  if ((await c.get("A")).tier !== "full") throw new Error("P4 带 pin 的会话写入失败");
  const r = await c.post("A", { pin: false });             // 旧的"取消勾选"
  if (r.ok !== true) throw new Error("P4 pin:false 应当被忽略并返回 ok，实际 " + JSON.stringify(r));
  if ((await c.get("A")).settings.source !== "session") throw new Error("P4 pin:false 不该再删除会话行");
  console.log("PASS P4 pin 字段被忽略（前向兼容，无副作用）");
}

// P5：会话行按 LRU 淘汰（超出 SETTINGS_MAX 丢最久未写的）
{
  const c = await boot("light");
  for (let i = 0; i < 55; i++) await c.post("s" + i, { tier: "full" });
  const first = await c.get("s0");
  const recent = await c.get("s54");
  const meta = await c.get("s54");
  if (recent.tier !== "full") throw new Error("P5 最近写入的行丢了");
  if (first.settings.source === "session") throw new Error("P5 最久没写的行没被淘汰");
  if (meta.settings.overrides > 50) throw new Error("P5 会话行超过上限：" + meta.settings.overrides);
  console.log("PASS P5 LRU 淘汰（" + meta.settings.overrides + " 行，最旧的被丢）");
}

// P6：客户端不再有「仅本会话 / 作用域」，且区分两个写入目标
{
  const raw = readFileSync(join(HERE, "..", "lib", "client.js"), "utf8");
  // 注释里保留"为什么取消"的说明是有价值的，这里只检查真正会被渲染/执行的代码
  const src = raw.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const bad of ["仅本会话", "作用域", "onlyThis", "pin: e.target.checked"]) {
    if (src.includes(bad)) throw new Error("P6 客户端仍含已移除的概念：" + bad);
  }
  if (!src.includes('commit(patch, target)')) throw new Error("P6 commit 没有 target 参数");
  if (!src.includes('commit({ tier: t.id }, "session")')) throw new Error("P6 面板没有写会话");
  if (!src.includes('commit({ tier: id }, "global")')) throw new Error("P6 设置页没有写全局");
  // 恢复入口已按需求移除（服务端 reset 能力保留，供脚本使用）
  if (src.includes("resetSession") || src.includes("恢复全局默认")) throw new Error("P6 面板仍残留恢复全局默认入口");
  console.log("PASS P6 客户端：无「仅本会话」，面板写会话 / 设置页写全局 / 无恢复入口");
}
