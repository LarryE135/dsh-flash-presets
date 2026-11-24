// 仅测试用：在真实 DSH 宿主里检查 flash_sh 是否注册，并经 ctx.tools.execute 跑一次，结果写到 FLASH_SH_PROBE_OUT，然后退出进程。
import fs from "node:fs";
export const name = "dsh-flash-sh-probe";
export const inject = ["tools"];
export function apply(ctx) {
  const out = process.env.FLASH_SH_PROBE_OUT;
  if (!out) return;
  const report = { pid: process.pid, platform: process.platform, arch: process.arch };
  setTimeout(async () => {
    try {
      const def = ctx.tools.get("flash_sh");
      report.registered = def !== undefined;
      report.globalTools = ctx.tools.schemas().map((s) => s.name).sort();
      if (typeof ctx.tools.sdkSchemas === "function") report.inSdk = ctx.tools.sdkSchemas().some((s) => s.name === "flash_sh");
      let buffer = [];
      try { buffer = (ctx.logger.buffer ?? []).map((m) => m.args.map(String).join(" ")).filter((l) => l.includes("[flash-sh]")); } catch (e) {}
      report.logs = buffer;
      if (def) {
        const signal = new AbortController().signal;
        const args = { command: "echo probe-$((40+2))", workdir: process.cwd() };
        let res;
        try {
          // 0.2.1-rc.5 的形状：一次一条调用
          res = await ctx.tools.execute({ callId: "probe-1", name: "flash_sh", arguments: args, signal });
        } catch (error) {
          // 0.2.2 起改为批量执行器：calls[{ id, name, arguments: JSON 文本 }]
          res = await ctx.tools.execute({ calls: [{ type: "tool-call", id: "probe-1", name: "flash_sh", arguments: JSON.stringify(args) }], signal });
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
