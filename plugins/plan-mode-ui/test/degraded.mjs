// 投影"在但还没写过" ≠ 投影不可用：面板不该误报「降级·按事件」
import { boot, report } from "./helpers/progress.mjs";

let failed = 0;
function ok(name, cond, extra) {
  if (!cond) { console.error("✗ " + name + (extra === undefined ? "" : "  -> " + extra)); failed += 1; }
  else console.log("✓ " + name);
}

const empty = { stateOf: () => null };
const h = await boot("light", { projections: empty });
const r = (await h.call("GET", "/api/plan-mode/progress", null, h.session.id)).body;
ok("空投影 → available", r.available === true, JSON.stringify({ a: r.available, d: r.degraded }));
ok("空投影 → 不降级", r.degraded === false, String(r.degraded));
ok("空投影 → health=unused", r.health === "unused", r.health);
ok("空投影 → 计数为 0", r.counts.total === 0 && r.counts.pending === 0, JSON.stringify(r.counts));
ok("空投影 → 来源 projection", r.source === "projection", r.source);

// 完全没有投影服务（极端情况）→ 仍标降级
const h2 = await boot("light");
const r2 = (await h2.call("GET", "/api/plan-mode/progress", null, h2.session.id)).body;
ok("无投影服务 → 降级", r2.degraded === true, String(r2.degraded));

report(failed, "degraded");
