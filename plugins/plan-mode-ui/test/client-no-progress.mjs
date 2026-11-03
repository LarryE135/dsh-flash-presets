// 面板只留档位控件：进度行（待办 x/y · 同步中）已按用户要求移除，原生的 todo 由 TodoDock 显示。
// 这里只做静态断言，防止以后有人把进度行"顺手加回来"。
import { readFileSync } from "node:fs";
import { report } from "./helpers/progress.mjs";

const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
let failed = 0;
function ok(name, cond, extra) {
  if (!cond) { console.error("✗ " + name + (extra === undefined ? "" : "  -> " + extra)); failed += 1; }
  else console.log("✓ " + name);
}

ok("不再轮询进度接口", !src.includes("/api/plan-mode/progress"));
ok("不再有 progressRow", !src.includes("progressRow"));
ok("不再有 nudge 按钮", !src.includes("nudgeProgress"));
ok("不再显示「待办 x/y」", !src.includes("待办 "));
ok("面板标题仍在", src.includes("计划模式 · 本对话"));
ok("档位滑杆仍在", src.includes("pmo-title") && src.includes("TIERS"));
ok("Max 开关仍在", src.includes("Max"));

report(failed, "client-no-progress");
