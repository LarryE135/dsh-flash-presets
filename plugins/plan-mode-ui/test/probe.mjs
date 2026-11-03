// 装配探针：一次 GET 就能看到"到底注入了哪一版"
import { boot, report } from "./helpers/progress.mjs";

let failed = 0;
function ok(name, cond, extra) {
  if (!cond) { console.error("✗ " + name + (extra === undefined ? "" : "  -> " + extra)); failed += 1; }
  else console.log("✓ " + name);
}

const nativeOn = { stateOf: (_s, name) => (name === "plan" ? { active: true } : null) };
const h = await boot("light", { projections: nativeOn });
h.section();                                          // 触发一次装配
const r = (await h.call("GET", "/api/plan-mode/state", null, h.session.id)).body;
const s = r.debug.section;
ok("探针存在", s !== null && s !== undefined, JSON.stringify(r.debug));
ok("探针键带 id: 前缀", s && s.key === "id:" + h.session.id, s && s.key);
ok("探针 tier 正确", s && s.tier === "light", s && s.tier);
ok("探针识破规划阶段", s && s.planning === true, s && String(s.planning));
ok("探针带文案摘要", s && typeof s.head === "string" && s.head.length > 10, s && s.head && s.head.slice(0, 40));
ok("探针带判定来源", s && s.sources !== undefined && s.sources.via === "projection", JSON.stringify(s && s.sources));

report(failed, "probe");
