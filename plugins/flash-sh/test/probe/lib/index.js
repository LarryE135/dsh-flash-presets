// 仅测试用：在真实 DSH 宿主里检查 fl_bash 是否注册，并经 ctx.tools.execute 跑一次，结果写到 FLASH_SH_PROBE_OUT，然后退出进程。
import fs from "node:fs";
export const name = "fl-bash-probe";
export const inject = ["tools"];
export function apply(ctx) {
  const out = process.env.FLASH_SH_PROBE_OUT;
  if (!out) return;
  const report = { pid: process.pid, platform: process.platform, arch: process.arch };
  setTimeout(async () => {
    try {
      const def = ctx.tools.get("fl_bash");
      report.registered = def !== undefined;
      report.globalTools = ctx.tools.schemas().map((s) => s.name).sort();
      report.flBashCount = report.globalTools.filter((n) => n === "fl_bash").length;
      report.legacyToolPresent = report.globalTools.includes("flash_sh");
      // 插件页读的清单（pluginInventory/list 的同一份投影）：每一行的模块名、启停、阶段与展示标题
      try {
        let inv;
        const svc = ctx.get && ctx.get("pluginInventory");
        if (svc && typeof svc.list === "function") inv = await svc.list();
        else {
          const spec = process.env.FL_BASH_PROBE_INVENTORY_MODULE || "@deepseek-ai/dsh-host-plugin-inventory";
          const m = await import(spec);
          inv = await m.readPluginInventory(ctx.root ?? ctx);
        }
        report.inventory = (inv.entries || []).map((e) => ({ moduleName: e.moduleName, enabled: e.enabled, fiberPhase: e.fiberPhase, title: e.meta && e.meta.title, description: e.meta && e.meta.description, diagnostic: e.diagnostic }));
      } catch (error) { report.inventoryError = String(error && error.message || error); }
      try {
        report.loaderRows = [...ctx.loader.entries()].filter((e) => !e.options.group).map((e) => ({ id: e.options.id, name: e.options.name, disabled: !!e.disabled, config: e.options.name && /fl-bash|flash-presets/.test(e.options.name) ? e.options.config : undefined }));
      } catch (error) { report.loaderError = String(error && error.message || error); }
      if (typeof ctx.tools.sdkSchemas === "function") report.inSdk = ctx.tools.sdkSchemas().some((s) => s.name === "fl_bash");
      let buffer = [];
      try { buffer = (ctx.logger.buffer ?? []).map((m) => m.args.map(String).join(" ")).filter((l) => l.includes("[fl-bash]")); } catch (e) {}
      report.logs = buffer;
      if (def) {
        const signal = new AbortController().signal;
        const args = { command: "echo probe-$((40+2))", workdir: process.cwd() };
        let res;
        try {
          // 0.2.1-rc.5 的形状：一次一条调用
          res = await ctx.tools.execute({ callId: "probe-1", name: "fl_bash", arguments: args, signal });
        } catch (error) {
          // 0.2.2 起改为批量执行器：calls[{ id, name, arguments: JSON 文本 }]
          res = await ctx.tools.execute({ calls: [{ type: "tool-call", id: "probe-1", name: "fl_bash", arguments: JSON.stringify(args) }], signal });
        }
        report.exec = res;
        const text = JSON.stringify(res);
        report.execOk = text.includes("probe-42") && /"exitCode":0/.test(text);
      }
    } catch (error) {
      report.error = String(error && error.stack || error) + (error && error.cause ? "\nCAUSE: " + String(error.cause.stack || error.cause) : "");
    }
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    process.exit(0);
  }, Number(process.env.FLASH_SH_PROBE_DELAY_MS || 4000));
}
