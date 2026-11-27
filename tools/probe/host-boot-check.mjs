#!/usr/bin/env node
// 断言 tools/probe/host-boot 探针在真实 DSH 宿主里采到的报告。CI 的 dsh-real job 用。
//   node tools/probe/host-boot-check.mjs <report.json> [--fl-bash default|off|skipped|registered]
//     default    不传时：原样安装（0.3.4 起 fl-bash 行默认 enabled:true）→ Windows x64 上注册一次，其他平台优雅跳过
//     off        行被关掉（enabled:false）→ fl_bash 不注册
//     skipped    行已打开（enabled:true），但宿主不是 Windows x64 → 优雅跳过、不注册
//     registered 行已打开且在 Windows x64 上 → 注册一次，并经真实管线执行成功
// 退出码：0 全部通过 · 1 有失败 · 2 报告读不了
import fs from "node:fs";

const [file, ...rest] = process.argv.slice(2);
const flBash = rest.includes("--fl-bash") ? rest[rest.indexOf("--fl-bash") + 1] : "default";
if (!["default", "off", "skipped", "registered"].includes(flBash)) { console.error("--fl-bash 只认 default / off / skipped / registered"); process.exit(2); }
let r;
try { r = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { console.error("读不了探针报告 " + file + "：" + error.message); process.exit(2); }

let bad = 0;
const check = (cond, label, extra) => { console.log((cond ? "  ✓ " : "  ✖ ") + label + (cond || extra === undefined ? "" : "（" + extra + "）")); if (!cond) bad++; };
const rows = new Map((r.loaderRows || []).map((x) => [x.id, x]));
const errs = Object.keys(r).filter((k) => k.endsWith("Error"));
console.log("宿主 " + r.platform + "-" + r.arch + " / node " + r.node);
check(errs.length === 0, "探针各步无异常", errs.map((k) => k + ": " + r[k]).join("; "));

// 插件页：本包 = 2 个预设行 + flash-presets 一行 + fl-bash 一行；旧的 4 个运行时行不应再出现
for (const id of ["preset-flash-lean-ptc-v3", "preset-flash-lean-ptc-v3-balance", "flash-presets", "fl-bash"]) {
  check(rows.has(id) && rows.get(id).disabled === false, "插件行 " + id + " 在且未禁用");
}
for (const id of ["flash-presets-core", "plan-mode-ui", "flash-presets-alias", "delivery-gate"]) check(!rows.has(id), "旧运行时行 " + id + " 不在");
check(rows.get("fl-bash")?.config?.enabled === (flBash !== "off"), "fl-bash 行 config.enabled = " + (flBash !== "off"), JSON.stringify(rows.get("fl-bash")?.config));
check(rows.get("flash-presets")?.config?.deliveryGate?.enabled === false, "交付门默认关闭");
const inv = new Map((r.inventory || []).map((e) => [e.moduleName, e]));
for (const m of ["dsh-flash-presets", "dsh-flash-presets/fl-bash"]) {
  const e = inv.get(m);
  check(e !== undefined && e.enabled === true && e.fiberPhase === "active" && !e.diagnostic, "插件清单 " + m + " active、无诊断", JSON.stringify(e));
}

// 预设：两条都在且没有 broken；历史 id 经别名层解析到 lean-v3
const presets = new Map((r.presets || []).map((p) => [p.id, p]));
for (const id of ["flash-lean-ptc-v3", "flash-lean-ptc-v3-balance"]) check(presets.has(id) && presets.get(id).broken === undefined, "预设 " + id + " 已注册且未 broken", JSON.stringify(presets.get(id)));
for (const [id, want] of Object.entries({ "flash-lean-ptc-v3-lite": "flash-lean-ptc-v3", "flash-lean-ptc-v2": "flash-lean-ptc-v3", "flash-lean": "flash-lean-ptc-v3" })) {
  check(r.resolveLegacy?.[id] === want, "历史 id " + id + " → " + want, r.resolveLegacy?.[id]);
}

// #29 守卫在真实 tools 管线上
check(r.guard29?.denied === true, "#29：run_code 内 exit_plan_mode 未给 timeoutMs 被拒");
check(r.guard29?.allowedWith600000 === true, "#29：timeoutMs 600000 放行");

// 原生计划模式（#45 依赖的宿主契约）
const p = r.plan || r.planPartial || {};
check(p.service === true, "lean-v3 会话里拿得到 planMode 服务");
check(p.setOn === "committed" && p.setOnAgain === "noop" && p.setOff === "committed", "planMode.set 返回 committed / noop / committed", [p.setOn, p.setOnAgain, p.setOff].join("/"));
check(p.cmdPlan === "success" && p.activeAfterPlan === true, "commands.execute(agent, \"/plan\") → success 且进入计划模式", p.cmdPlan + "/" + p.activeAfterPlan);
check(p.cmdPlanOff === "success" && p.activeAfterOff === false, "\"/plan off\" → success 且退出", p.cmdPlanOff + "/" + p.activeAfterOff);
const ev = p.events || [];
check(ev.includes("plan/mode:true") && ev.includes("plan/mode:false"), "session/event 上收到 plan/mode true / false", ev.join(","));

// fl-bash：关掉 / 非 Windows 上打开 → 不注册；Windows x64 上打开后 → 注册且经真实管线执行成功；
// 默认（原样安装，默认开）：Windows x64 上注册一次（默认审批模式下不在这里执行命令），其他平台不注册
if (flBash === "default") {
  const winx64 = r.platform === "win32" && r.arch === "x64";
  check(r.flBashRegistered === winx64, winx64 ? "默认开：fl_bash 已注册" : "默认开：fl_bash 未注册（非 Windows x64，优雅跳过）");
  if (winx64) check((r.tools || []).filter((t) => t === "fl_bash").length === 1, "fl_bash 只注册一次");
} else if (flBash === "registered") {
  check(r.flBashRegistered === true, "fl_bash 已注册");
  check((r.tools || []).filter((t) => t === "fl_bash").length === 1, "fl_bash 只注册一次");
  check(r.flBashExec?.ok === true, "fl_bash 经 ctx.tools.execute 输出 probe-42、exitCode 0", r.flBashExec?.raw);
} else {
  check(r.flBashRegistered === false, flBash === "skipped" ? "fl_bash 未注册（非 Windows x64，优雅跳过）" : "fl_bash 未注册（已关掉）");
}

console.log(bad === 0 ? "宿主探针：全部通过" : "宿主探针：" + bad + " 项失败");
process.exit(bad === 0 ? 0 : 1);
