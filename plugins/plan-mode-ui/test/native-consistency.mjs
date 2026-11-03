// 单一判据：段落 / /state.native / /progress.plan.native 必须同源（投影优先，服务次之，簿记兜底）
import { boot, report } from "./helpers/progress.mjs";

let failed = 0;
function ok(name, cond, extra) {
  if (!cond) { console.error("✗ " + name + (extra === undefined ? "" : "  -> " + extra)); failed += 1; }
  else console.log("✓ " + name);
}

// ① 投影不可读 + 服务说"计划模式开着" → 三处都判 true，段落给延后版
const svcOnly = { services: { planMode: { loggedActive: () => true } } };
const h1 = await boot("light", svcOnly);
const text1 = h1.section();                       // 先装配，探针才有内容
const s1 = (await h1.call("GET", "/api/plan-mode/state", null, h1.session.id)).body;
const p1 = (await h1.call("GET", "/api/plan-mode/progress", null, h1.session.id)).body;
ok("服务兜底：state.native=true", s1.native === true, String(s1.native));
ok("服务兜底：段落用延后版", text1.includes("TODO SYNC (deferred)"), text1.slice(0, 60));
ok("服务兜底：探针来源=service 或 bookkeeping", ["service", "bookkeeping"].includes((((s1.debug.section || {}).sources) || {}).via), JSON.stringify((s1.debug.section || {}).sources));

// ② 投影明确说"未激活"，但服务仍返回 true → 以投影为准，三处都必须 false
const svcPlusProj = {
  services: { planMode: { loggedActive: () => true } },
  projections: { stateOf: (_s, name) => (name === "plan" ? { active: false } : null) }
};
const h2 = await boot("light", svcPlusProj);
const text2 = h2.section();                       // 先装配，探针才有内容
const s2 = (await h2.call("GET", "/api/plan-mode/state", null, h2.session.id)).body;
const p2 = (await h2.call("GET", "/api/plan-mode/progress", null, h2.session.id)).body;
ok("投影优先：state.native=false", s2.native === false, String(s2.native));
ok("投影优先：progress.plan.native=false", p2.plan.native === false, JSON.stringify(p2.plan));
ok("投影优先：段落用纪律版", text2.includes("TODO SYNC (do not batch)"), text2.slice(0, 60));
ok("投影优先：探针来源=projection", (((s2.debug.section || {}).sources) || {}).via === "projection", JSON.stringify((s2.debug.section || {}).sources));

report(failed, "native-consistency");
