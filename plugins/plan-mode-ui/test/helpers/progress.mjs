import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

let seq = 0;

export async function boot(tier, opts) {
  const o = opts || {};
  const home = mkdtempSync(join(tmpdir(), "pmui-prog-"));
  mkdirSync(join(home, "plan-mode-ui"), { recursive: true });
  writeFileSync(join(home, "plan-mode-ui", "state.json"),
    JSON.stringify({ version: 1, default: { tier: tier || "full", scope: "always", max: false }, sessions: {} }));
  process.env.DSH_HOME = home;
  const handlers = new Map();
  const routes = new Map();
  let sectionSpec = null;
  const { default: plugin } = await import("../../lib/index.js?prog" + (++seq) + "-" + Date.now());
  const ctx = {
    // 支持注入服务（如 planMode）：段落判据会先问服务，再退回投影
    get: (name) => (o.services && o.services[name]) ?? undefined,
    on: (n, fn) => handlers.set(n, fn),
    effect: (fn) => { try { fn(); } catch (e) {} },
    webServer: { register: (spec) => { routes.set(spec.path, spec.handler); return () => {}; } },
    systemPrompt: { section: (spec) => { sectionSpec = spec; return () => {}; }, getSectionOrder: () => 500 },
    logger: { warn() {}, info() {} }
  };
  if (o.projections) ctx.sessionProjections = o.projections;
  plugin.apply(ctx, o.config || {});
  const session = { id: "prog-" + seq, delegationDepth: 0 };
  handlers.get("agent/created")?.({ agent: { session, steer() {}, inject() {} } });
  const fire = (n, ...a) => handlers.get(n)?.(...a);

  function call(method, path, body, sessionId, opts) {
    const o2 = opts || {};
    return new Promise((resolve) => {
      const req = new EventEmitter();
      req.method = method;
      req.url = path + (sessionId ? "?session=" + encodeURIComponent(sessionId) : "");
      req.headers = { host: "127.0.0.1:3081" };
      if (o2.client !== false) req.headers["x-plan-mode-client"] = "1";
      let status = 200;
      const res = { writeHead(code) { status = code; }, end(text) { resolve({ status, body: JSON.parse(text) }); } };
      const handler = routes.get(path);
      if (!handler) { resolve({ status: 0, body: { ok: false, message: "route missing" } }); return; }
      handler(req, res);
      if (method === "POST") req.emit("data", Buffer.from(JSON.stringify(body || {})));
      req.emit("end");
    });
  }

  return { session, fire, call, section: () => (sectionSpec === null ? "" : sectionSpec.text({ agent: { session } })) };
}

export function report(failed, name) {
  if (failed > 0) { console.error(failed + " 个用例失败"); process.exit(1); }
  console.log(name + " 全部通过");
}
