/**
 * flash-presets-core：把 run_code 优化 A（glob/grep 只读并发安全）拆成独立插件行。
 *
 * 为什么要有这一行：0.3.0 里 A 是搭 plan-mode-ui 那行的车（lib/index.js 的 apply 里调
 * installToolConcurrency）。后果有两个，都在实测里撞见过：
 *   1. 关掉计划模式组件、或用只挂部分行的精简组合 → A 静默消失，日志里一个字都没有；
 *   2. plan-mode-ui 的 inject 含 webServer / systemPrompt，宿主缺任一个就停在 pending，
 *      连带 A 也不跑（headless、部分桌面端场景）。
 * 拆出来之后这一行只 inject tools / agents，任何宿主都能挂，语义也对得上：
 * “装上这个包”= “run_code 优化生效”，与计划模式开不开无关。
 *
 * 这一行只做三件事：装 A、把结果记成状态、把它打成人能读懂的一行日志。
 * 关闭方式（优先级从高到低）：DSH_FLASH_PRESETS_CONCURRENCY=0 > 本行 config.toolConcurrency.enabled=false > 默认开启。
 */
import { createRequire } from "node:module";
import { installToolConcurrency } from "./tool-concurrency.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

export const VERSION = typeof pkg.version === "string" ? pkg.version : "0.0.0";
const TAG = "[flash-presets-core]";

let status = Object.freeze({ version: VERSION, installed: false, active: false, reason: "not-mounted", targets: [], sweepMs: 0, witness: "n/a", scopes: 0 });

/** 当前状态（给 /api/flash-presets/core 与测试用）。 */
export function coreStatus() {
  return status;
}

function patch(next) {
  status = Object.freeze({ ...status, ...next });
  return status;
}

function sendJson(res, code, body) {
  try {
    res.statusCode = code;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(body));
  } catch (error) {
    try { res.end(); } catch (error2) {}
  }
}

export default {
  name: "flash-presets-core",
  inject: ["tools", "agents"],
  apply(ctx, config) {
    const cfg = config !== null && typeof config === "object" ? config : {};
    const tc = cfg.toolConcurrency !== null && typeof cfg.toolConcurrency === "object" ? cfg.toolConcurrency : {};
    try {
      const result = installToolConcurrency(ctx, {
        ...tc,
        version: VERSION,
        onStatus: (next) => { try { patch(next); } catch (error) {} },
      });
      const installed = result !== null && typeof result === "object" && result.installed === true;
      patch({
        installed,
        // 关掉 / 装不上时必须把 active 压回 false，不能留着上一次的 true
        active: installed ? status.active === true : false,
        reason: result !== null && typeof result === "object" && result.reason !== undefined ? result.reason : null,
        targets: result !== null && typeof result === "object" && Array.isArray(result.targets) ? result.targets : [],
        sweepMs: result !== null && typeof result === "object" ? Number(result.sweepMs ?? 0) : 0,
        witness: installed ? status.witness : "n/a",
        scopes: installed ? status.scopes : 0,
      });
    } catch (error) {
      const reason = String((error && error.message) || error);
      patch({ installed: false, active: false, reason });
      try { console.warn(TAG + " 未生效｜原因=" + reason + "｜其余功能不受影响（这一项只是让 glob/grep 并行）"); } catch (error2) {}
    }

    // 宿主有 webServer 时把状态挂出去（没注入就不挂，不阻塞 headless / 桌面端）
    try {
      const webServer = ctx.webServer !== undefined ? ctx.webServer : (typeof ctx.get === "function" ? ctx.get("webServer") : undefined);
      if (webServer !== undefined && webServer !== null && typeof webServer.register === "function" && typeof ctx.effect === "function") {
        ctx.effect(() => {
          const dispose = webServer.register({
            kind: "exact",
            path: "/api/flash-presets/core",
            handler: (req, res) => sendJson(res, 200, { ok: true, core: coreStatus() }),
          });
          return () => { if (typeof dispose === "function") dispose(); };
        }, "flash-presets-core: status route");
      }
    } catch (error) {}
  },
};
