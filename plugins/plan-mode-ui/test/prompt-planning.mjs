// 计划阶段 ↔ 执行阶段 的 todo 文案必须互斥（plan mode 明令禁止用 todo_write 记录规划过程）
import { boot, report } from "./helpers/progress.mjs";

let failed = 0;
function ok(name, cond, extra) {
  if (!cond) { console.error("✗ " + name + (extra === undefined ? "" : "  -> " + extra)); failed += 1; }
  else console.log("✓ " + name);
}

const nativeOn = { stateOf: (_s, name) => (name === "plan" ? { active: true } : null) };
const nativeOff = { stateOf: (_s, name) => (name === "plan" ? { active: false } : null) };

const a = await boot("light", { projections: nativeOn });
const aText = a.section();
ok("规划阶段用延后版", aText.includes("TODO SYNC (deferred)"), aText.slice(0, 80));
ok("规划阶段不要求建列表", !aText.includes("Before the first tool call"), aText.slice(0, 80));
ok("规划阶段仍承诺批准后建列表", /FIRST action is todo_write/.test(aText));

const b = await boot("light", { projections: nativeOff });
const bText = b.section();
ok("执行阶段用纪律版", bText.includes("TODO SYNC (do not batch)"), bText.slice(0, 80));
ok("执行阶段不含延后版", !bText.includes("TODO SYNC (deferred)"));
ok("两版不会同时出现", !(aText.includes("do not batch") && aText.includes("(deferred)")));

// 服务可用时（planMode.loggedActive 为真）首个装配就必须是延后版：
// 重启后投影/桥接簿记尚未填充，只有服务是立刻可信的判据。
const svc = await boot("light", { services: { planMode: { loggedActive: () => true } } });
const sText = svc.section();
ok("服务可信时首个装配即延后版", sText.includes("TODO SYNC (deferred)"), sText.slice(0, 70));
ok("服务可信时不给「立刻建列表」", !sText.includes("Before the first tool call"));

// 关档时不注入任何 todo 文案
const c = await boot("off", { projections: nativeOff });
ok("关档不注入", !c.section().includes("TODO SYNC"));

report(failed, "prompt-planning");
