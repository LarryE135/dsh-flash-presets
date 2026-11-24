// 用法：APPROVAL_PROBE_OUT=/path/out.json dsh --profile <p> --patch <插入本文件为一行的补丁>（profile 里 flash-presets.config.flashSh 或 flash-sh-standalone 已启用、approval=sandboxed）；
// 跑完写报告并退出进程。第二轮审计（2026-11-24）在 DSH 0.2.2-rc.1 上实走过，结果见审计报告。
// 审批闸实走（第二轮审计 T7）：真实 DSH 宿主里建一个真实会话，会话权限 workspace-write，打开一个回合，
// 经 ctx.tools.execute 调 flash_sh（approval=sandboxed）。本插件在 DSH 的 approval/request 瀑布上挂一个应答者，
// 扮演「测试客户端」：记录收到的审批请求并按脚本应答（拒绝 / 允许一次）。网页端的远程应答者（dsh-api-remotes）
// 走同一个瀑布；本探针不经 WebSocket 传输层。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const OUT = process.env.APPROVAL_PROBE_OUT;
export const name = 'flash-sh-approval-probe';
export const inject = ['tools', 'sessionController', 'sandboxPolicy', 'approval'];
export function apply(ctx) {
  if (!OUT) return;
  const report = { steps: [], asked: [] };
  const script = [];
  // 「测试客户端」：只应答 flash_sh 的审批，其余交给下一个应答者
  ctx.on('dispose', () => console.info('[approval-probe] probe context disposed'));
  // prepend：排在网页端远程应答者（dsh-api-remotes，没有连上的客户端时它直接答 unavailable）前面；global：不受会话作用域过滤
  ctx.on('approval/request', (req, next) => {
    if (!req || req.toolName !== 'flash_sh') return next();
    const answer = script.shift() ?? 'rejected';
    report.asked.push({ callId: req.callId, answer, reason: String(req.reason ?? '').slice(0, 400) });
    return Promise.resolve(answer);
  }, { prepend: true, global: true });
  setTimeout(async () => {
    try {
      const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.homedir(), 'approval-ws-')));
      fs.mkdirSync(path.join(ws, 'sub'));
      report.ws = ws;
      const root = ctx.root;
      const ctl = root.get('sessionController');
      let r;
      try { r = await ctl.agents.createSession({ cwd: ws }); } catch (e) { r = await ctl.agents.createSession({ cwd: ws, agentPreset: 'flash-lean-ptc-v3' }); }
      const agent = r.agent;
      const session = agent.session;
      session.append('sandbox/mode', { mode: 'workspace-write' });
      report.mode = ctx.sandboxPolicy.resolve({ session }).mode;
      report.approvalPolicy = ctx.approval.effectivePolicy ? ctx.approval.effectivePolicy(session) : 'n/a';
      const tools = root.get('tools');
      report.registered = tools.get('flash_sh') !== undefined;
      session.append('turn/start', { turn: 1 });
      let n = 0;
      const call = async (command, answer) => {
        if (answer !== undefined) script.push(answer);
        const before = report.asked.length;
        const res = await tools.execute({ calls: [{ type: 'tool-call', id: 'ap-' + ++n, name: 'flash_sh', arguments: JSON.stringify({ command }) }], signal: new AbortController().signal, agent });
        const text = JSON.stringify(res);
        const step = { command, scripted: answer ?? null, asked: report.asked.length - before, result: text.slice(0, 600) };
        report.steps.push(step);
        return step;
      };
      await call('touch rejected-marker', 'rejected');
      report.rejectedMarkerExists = fs.existsSync(path.join(ws, 'rejected-marker'));
      await call('touch approved-marker', 'allowed-once');
      report.approvedMarkerExists = fs.existsSync(path.join(ws, 'approved-marker'));
      await call('touch approved-marker-2');   // 同类（touch [>]）：本会话已批准，不应再问
      report.approved2Exists = fs.existsSync(path.join(ws, 'approved-marker-2'));
      await call('rm -rf sub', 'rejected');    // 危险：每次都问；拒绝 → 不执行
      report.subStillExists = fs.existsSync(path.join(ws, 'sub'));
      await call('rm -rf sub', 'rejected');
      await call('PATH=/tmp ls', 'rejected');   // 对抗写法：每次都问
      const types = [];
      for (let s = 0; s < session.seq; s++) { const ev = session.eventAt(s); if (ev && /^approval\//.test(ev.type)) types.push(ev.type + (ev.data && ev.data.outcome ? ':' + ev.data.outcome : '')); }
      report.auditEvents = types;
      try { session.append('turn/end', { turn: 1, reason: 'completed' }); } catch (e) { report.turnEndError = String(e.message || e).slice(0, 200); }
      try { report.logs = (root.logger.buffer ?? []).map((m) => m.args.map(String).join(' ')).filter((l) => l.includes('[flash-sh]') || l.includes('[flash-presets]')).slice(-40); } catch (e) {}
    } catch (e) {
      report.error = String(e && e.stack || e).slice(0, 2000);
    }
    fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
    setTimeout(() => process.exit(0), 500);
  }, Number(process.env.APPROVAL_PROBE_DELAY || 8000));
}
