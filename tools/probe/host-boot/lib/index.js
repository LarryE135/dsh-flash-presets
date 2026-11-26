// CI 专用探针：和 dsh-flash-presets 装进同一个 profile，在真实 DSH 宿主启动后读取
//   插件行（loader）/ 预设列表与历史 id 解析 / #29 评审超时守卫 / 原生计划模式服务与 /plan 命令 / fl_bash 注册与执行，
// 结果写到 $DSH_HOST_PROBE_OUT 后退出进程。只读宿主状态；建的那个会话落在 CI 的临时 DSH_HOME 里。
// 断言不写在这里（探针只采集），见 tools/probe/host-boot-check.mjs。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const name = "dsh-host-boot-probe";
export const inject = ["tools"];

const text = (e) => String((e && (e.stack || e.message)) || e).split("\n").slice(0, 3).join(" | ");

export function apply(ctx) {
  const out = process.env.DSH_HOST_PROBE_OUT;
  if (!out) return;
  const r = { pid: process.pid, platform: process.platform, arch: process.arch, node: process.version };
  setTimeout(async () => {
    const step = async (key, fn) => { try { r[key] = await fn(); } catch (error) { r[key + "Error"] = text(error); } };
    await step("tools", () => ctx.tools.schemas().map((s) => s.name).sort());
    await step("flBashRegistered", () => ctx.tools.get("fl_bash") !== undefined);
    await step("loaderRows", () => [...ctx.loader.entries()]
      .filter((e) => !e.options.group && /flash|fl-bash|ptc-runtime|delivery-gate|plan-mode-ui/.test(String(e.options.id)))
      .map((e) => ({ id: e.options.id, name: e.options.name, disabled: !!e.disabled, config: /^preset-/.test(String(e.options.id)) ? undefined : e.options.config })));
    await step("inventory", async () => {
      const svc = ctx.get && ctx.get("pluginInventory");
      let inv;
      if (svc && typeof svc.list === "function") inv = await svc.list();
      else inv = await (await import("@deepseek-ai/dsh-host-plugin-inventory")).readPluginInventory(ctx.root ?? ctx);
      return (inv.entries || []).filter((e) => /^dsh-flash-presets/.test(String(e.moduleName)))
        .map((e) => ({ moduleName: e.moduleName, enabled: e.enabled, fiberPhase: e.fiberPhase, title: e.meta && e.meta.title, diagnostic: e.diagnostic }));
    });
    await step("presets", async () => await ctx.get("agentPresets").list());
    await step("resolveLegacy", async () => {
      const ap = ctx.get("agentPresets");
      const o = {};
      for (const id of ["flash-lean-ptc-v3", "flash-lean-ptc-v3-balance", "flash-lean-ptc-v3-lite", "flash-lean-ptc-v2", "flash-lean"]) {
        try { o[id] = (await ap.resolve(id)).id; } catch (error) { o[id] = "ERR " + String((error && error.code) || "") + " " + text(error).slice(0, 120); }
      }
      return o;
    });
    // #29：run_code 里调 exit_plan_mode 却没给 timeoutMs ≥ 600000 → 宿主管线在派发前拒绝
    await step("guard29", () => {
      const agent = { session: { id: "host-boot-probe", delegationDepth: 0 } };
      const code = "await exit_plan_mode({ plan: '# t' })";
      const deny = ctx.tools.checkGuards({ name: "run_code", callId: "g1", arguments: { code }, agent });
      const allow = ctx.tools.checkGuards({ name: "run_code", callId: "g2", arguments: { code, timeoutMs: 600000 }, agent });
      const reason = deny === undefined ? null : typeof deny === "string" ? deny : String(deny.reason);
      return { denied: reason !== null && reason.includes("timeoutMs"), allowedWith600000: allow === undefined };
    });
    // 原生计划模式：在 lean-v3 预设上建一个会话（不发任何 LLM 请求），走插件依赖的两条通道
    //   planMode.set() 的返回值（committed / noop）与 commands.execute(agent, "/plan" | "/plan off", [], signal)
    await step("plan", async () => {
      const o = {};
      r.planPartial = o;
      const ap = ctx.get("agentPresets");
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "host-boot-probe-"));
      const created = await ctx.get("agents").create({
        sessionId: "session-host-boot-probe-" + Date.now(),
        meta: { cwd, agentPreset: "flash-lean-ptc-v3" },
        agentOptions: { provider: "deepseek", model: "deepseek-chat" },
        setup: async (agentCtx) => { await ap.mount(agentCtx, "flash-lean-ptc-v3"); },
      });
      const agent = created.agent ?? created;
      const seen = [];
      const off = ctx.on("session/event", (session, ev) => {
        if (session === agent.session && /^(plan|command)\//.test(String(ev.type))) seen.push(ev.type + (ev.data && ev.data.active !== undefined ? ":" + ev.data.active : ""));
      });
      const svc = ap.serviceFor(agent, "planMode");
      o.service = svc !== undefined && svc !== null && typeof svc.set === "function";
      if (o.service) {
        o.setOn = svc.set(agent, true);
        o.setOnAgain = svc.set(agent, true);
        o.setOff = svc.set(agent, false);
      }
      const signal = new AbortController().signal;
      const cmds = ctx.get("commands");
      const on = await cmds.execute(agent, "/plan", [], signal);
      o.cmdPlan = on && on.result ? on.result.kind : String(on);
      o.activeAfterPlan = o.service ? svc.loggedActive(agent.session) : undefined;
      const offed = await cmds.execute(agent, "/plan off", [], signal);
      o.cmdPlanOff = offed && offed.result ? offed.result.kind : String(offed);
      o.activeAfterOff = o.service ? svc.loggedActive(agent.session) : undefined;
      await new Promise((res) => setTimeout(res, 200));
      o.events = seen;
      try { if (typeof off === "function") off(); } catch (error) {}
      return o;
    });
    if (r.flBashRegistered === true) {
      await step("flBashExec", async () => {
        const args = { command: "echo probe-$((40+2))", workdir: process.cwd() };
        const res = await ctx.tools.execute({ calls: [{ type: "tool-call", id: "probe-1", name: "fl_bash", arguments: JSON.stringify(args) }], signal: new AbortController().signal });
        const s = JSON.stringify(res);
        return { ok: s.includes("probe-42") && /"exitCode":0/.test(s), raw: s.slice(0, 600) };
      });
    }
    fs.writeFileSync(out, JSON.stringify(r, null, 2));
    process.exit(0);
  }, Number(process.env.DSH_HOST_PROBE_DELAY_MS || 8000));
}
