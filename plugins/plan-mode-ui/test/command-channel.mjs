// 命令通道：commands.execute(agent, line, attachments, signal) 的第 4 个参数是必需的 AbortSignal，
// 缺失时 async 函数体内 signal.aborted 直接抛错 → 桥接"成功"但从未生效（0.5.0 的真实故障）。
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let n = 0;
function boot() {
  const home = mkdtempSync(join(tmpdir(), "pmui-cmd-"));
  mkdirSync(join(home, "plan-mode-ui"), { recursive: true });
  writeFileSync(join(home, "plan-mode-ui", "state.json"), JSON.stringify({ version: 1, default: { tier: "light", scope: "always", max: false }, sessions: {} }));
  process.env.DSH_HOME = home;
  const seen = [];
  const commands = {
    execute(agent, line, attachments, signal) {           // 真机实现会读 signal.aborted
      if (signal === undefined) throw new TypeError("signal is required");
      if (signal.aborted) throw new Error("aborted");
      seen.push(line);
      return Promise.resolve({ commandId: "c1", result: { kind: "success" } });
    }
  };
  return import("../lib/index.js?cmd" + (++n) + "-" + Date.now()).then(({ default: plugin }) => {
    const handlers = new Map();
    const ctx = {
      get: (name) => (name === "commands" ? commands : undefined),   // 只有命令通道可用（planMode 被隔离）
      on: (name, fn) => handlers.set(name, fn),
      inject: () => {},
      effect: (fn) => { try { fn(); } catch (e) {} },
      webServer: { register: () => () => {} },
      systemPrompt: { section: () => {}, getSectionOrder: () => 500 },
      logger: { warn() {}, info() {} }
    };
    plugin.apply(ctx);
    const session = { id: "cmd-" + n, delegationDepth: 0 };
    handlers.get("agent/created")?.({ agent: { session, steer() {}, inject() {} } });
    return { fire: (t, ...a) => handlers.get(t)?.(...a), session, seen };
  });
}

const c = await boot();
c.fire("session/event", c.session, { type: "turn/start", data: { turn: 2 } });
c.fire("session/event", c.session, { type: "user/message", data: { turn: 2, content: [{ type: "text", text: "继续" }], source: { kind: "user" } } });
// C1a：事件派发栈内绝不能同步执行（会话正在 append，会触发
// "session append cannot reenter while another append is being published"）
if (c.seen.length !== 0) throw new Error("C1a 事件派发期间就执行了 /plan（重入风险），实际 " + JSON.stringify(c.seen));
console.log("PASS C1a 命令被推迟到派发栈之外执行");

await new Promise((r) => setTimeout(r, 20));
if (!c.seen.includes("/plan")) throw new Error("C1 期望通过命令通道执行 /plan，实际 " + JSON.stringify(c.seen));
console.log("PASS C1 命令通道带 AbortSignal 并真的执行 /plan");
