// 0.7.0：无头 =prompt 模式 —— 注入计划正文但不桥接原生计划模式（否则会卡在规划阶段）
import { boot, report } from "./helpers/progress.mjs";

let failed = 0;
function ok(name, cond, extra) {
  if (!cond) { console.error("✗ " + name + (extra === undefined ? "" : "  -> " + extra)); failed += 1; }
  else console.log("✓ " + name);
}

process.env.DSH_PLAN_MODE_UI_HEADLESS = "prompt";
try {
  const light = await boot("light");
  const t1 = light.section();
  ok("light 注入 P0-EXEC 正文", t1.includes("P0-EXEC.yml"), t1.slice(0, 80));
  ok("light 注入 CONVENTIONS", t1.includes("CONVENTIONS.md"));
  ok("light 给「本回合实现」的尾巴", /in this same turn/.test(t1));
  ok("light 仍带 todo 纪律", t1.includes("TODO SYNC"));
  ok("light 不再「让位」空注入", t1.trim().length > 300, String(t1.length));

  const full = await boot("full");
  const t2 = full.section();
  ok("full 注入 EVIDENCE", t2.includes("EVIDENCE.md"), t2.slice(0, 80));
  ok("full 注入 P1-TARGETS", t2.includes("P1-TARGETS.yml"));
  ok("full 也说明本回合实现", /in this same turn/.test(t2));

  const off = await boot("off");
  ok("关档仍不注入", off.section().trim() === "");
} finally { delete process.env.DSH_PLAN_MODE_UI_HEADLESS; }

// 未设环境变量时行为不变：light 仍然只是桥接档（不注入正文）
const plain = await boot("light");
ok("默认无头行为不变（light 不注入正文）", !plain.section().includes("P0-EXEC.yml"), plain.section().slice(0, 60));

report(failed, "headless-prompt");
