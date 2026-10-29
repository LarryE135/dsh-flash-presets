import { Service } from "@deepseek-ai/cordis";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

const KEY = "planProbe";
const TIERS = new Set(["off", "light", "full"]);

// Q1：并发 / 时序 / 速率 —— 实测唯一能稳定打穿 light 档的能力要求
const Q1_PATTERNS = [
  [/并发/, "并发"], [/限速/, "限速"], [/速率限制/, "速率限制"],
  [/令牌桶/, "令牌桶"], [/退避/, "退避"], [/重试/, "重试"], [/信号量/, "信号量"],
  [/线程池/, "线程池"], [/工作池/, "工作池"],
  [/\bQPS\b/i, "QPS"], [/\bRPS\b/i, "RPS"], [/rate.?limit/i, "rate-limit"],
  [/backoff/i, "backoff"], [/retry/i, "retry"], [/throttl/i, "throttle"],
  [/concurren/i, "concurrency"], [/semaphore/i, "semaphore"], [/worker.?pool/i, "worker-pool"],
  [/\b429\b/, "429"], [/\b503\b/, "503"], [/too many requests/i, "too-many-requests"],
  [/requests? per second/i, "rps-words"], [/at most \d+ (?:at a time|concurrently)/i, "at-most-n"]
];

export function detectQ1(text) {
  const s = String(text || "");
  for (const [re, tag] of Q1_PATTERNS) if (re.test(s)) return tag;
  return null;
}

function userText(data) {
  const out = [];
  const walk = (v, d) => {
    if (d > 4 || v == null) return;
    if (typeof v === "string") { out.push(v); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, d + 1); return; }
    if (typeof v === "object") {
      if (v.source?.kind === "agent-instructions") return;
      if (typeof v.text === "string") out.push(v.text);
      if (v.content) walk(v.content, d + 1);
    }
  };
  walk(data, 0);
  return out.join("\n");
}

function makeProjection(cfg) {
  return {
    key: KEY,
    stateVersion: 2,
    stateSchema: z.object({
      tier: z.string().nullable(),
      turns: z.number(),
      escalatedFrom: z.string().nullable(),
      reason: z.string().nullable(),
      q1: z.string().nullable()
    }).strict(),
    init: () => ({ tier: null, turns: 0, escalatedFrom: null, reason: null, q1: null }),
    apply: (state, event) => {
      if (event.type === "command/run" && event.data?.name === "plan-tier") {
        const want = String(event.data.args || "").trim().toLowerCase();
        if (!TIERS.has(want)) return state;
        return { ...state, tier: want, escalatedFrom: null, reason: "manual" };
      }
      if (event.type === "user/message" && cfg.escalateOnQ1) {
        const tier = state.tier ?? cfg.tier;
        if (tier === "light" && !state.escalatedFrom) {
          const tag = detectQ1(userText(event.data));
          if (tag) return { ...state, tier: "full", escalatedFrom: "q1", reason: tag, q1: tag };
        }
      }
      if (event.type === "turn/start") return { ...state, turns: state.turns + 1 };
      return state;
    },
    wire: {
      viewSchema: z.object({
        tier: z.string(), turns: z.number(),
        escalatedFrom: z.string().nullable(), reason: z.string().nullable(), q1: z.string().nullable()
      }),
      view: (s) => ({ tier: s.tier ?? "light", turns: s.turns, escalatedFrom: s.escalatedFrom, reason: s.reason, q1: s.q1 })
    }
  };
}

class PlanProbe extends Service {
  static inject = ["systemPrompt", "sessionProjections"];

  constructor(ctx, config = {}) {
    super(ctx, "planProbe");
    const cfg = {
      tier: process.env.PLAN_TIER || config.tier || "light",
      scope: process.env.PLAN_SCOPE || config.scope || "always",
      acceptanceFile: process.env.PLAN_ACCEPTANCE_FILE || config.acceptanceFile || "P0-EXEC.yml",
      fullAcceptanceFile: config.fullAcceptanceFile || "P0-EXEC.full.yml",
      sectionOrder: config.sectionOrder ?? 42,
      escalateOnNoArtifact: config.escalateOnNoArtifact !== false,
      escalateOnQ1: config.escalateOnQ1 !== false
    };

    ctx.sessionProjections.register(makeProjection(cfg));
    this.ctx = ctx;
    this.cfg = cfg;

    ctx.inject(["commands"], (c) => {
      c.commands.register({
        definitionId: "dsh-plan-tier",
        name: "plan-tier",
        description: "Set planning tier for this session (off | light | full)",
        input: { hint: "[off|light|full]" },
        handler: ({ rawInput }) => {
          const want = String(rawInput || "").trim().toLowerCase();
          if (!TIERS.has(want)) return { kind: "error", text: "usage: /plan-tier off | light | full" };
          return { kind: "success", text: "planning tier: " + want };
        }
      });
    });

    // 升档信号①：第 1 轮结束无任何新文件
    ctx.on("session/event", (event) => {
      if (event.type !== "turn/end") return;
      const session = event.agent?.session;
      if (!session) return;
      const st = this.ctx.sessionProjections.stateOf(session, KEY) || {};
      const tier = st.tier ?? cfg.tier;
      if (tier !== "light" || !cfg.escalateOnNoArtifact) return;
      if (!filesNewerThan(session.cwd, session.startedAt ?? 0)) {
        this.ctx.sessionProjections.setState?.(session, KEY, {
          ...st, tier: "full", escalatedFrom: "light", reason: "turn-1 无产物", turns: st.turns ?? 0
        });
      }
    });

    ctx.systemPrompt.section({
      name: "plan-probe:acceptance",
      order: cfg.sectionOrder,
      text: (context) => {
        const agent = context.agent;
        const st = agent ? this.ctx.sessionProjections.stateOf(agent.session, KEY) : null;
        const tier = (st?.tier) ?? cfg.tier;
        const turns = st?.turns ?? 0;
        try {
          fs.writeFileSync("/tmp/plan-probe-tier.json", JSON.stringify({
            tier, turns, escalatedFrom: st?.escalatedFrom ?? null, reason: st?.reason ?? null, q1: st?.q1 ?? null
          }));
        } catch {}
        if (tier === "off") return "";
        if (cfg.scope === "first" && turns > 1) return "";
        const file = tier === "full" ? cfg.fullAcceptanceFile : cfg.acceptanceFile;
        let body = "";
        try { body = fs.readFileSync(file, "utf8"); } catch { return "PLAN-TIER: " + tier + " (no acceptance file: " + file + ")"; }
        const head = "ACCEPTANCE (tier=" + tier + ", scope=" + cfg.scope + (st?.escalatedFrom ? ", escalated-from=" + st.escalatedFrom + " (" + st.reason + ")" : "") + ")";
        return head + "\n" + body;
      }
    });
  }
}

function filesNewerThan(dir, since) {
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(".") || name === "logs" || name === "node_modules") continue;
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isFile() && st.mtimeMs > since + 1000) return true;
    }
  } catch {}
  return false;
}

export function apply(ctx, config) {
  try { fs.writeFileSync("/tmp/plan-probe-loaded.txt", JSON.stringify(config ?? {})); } catch {}
  ctx.plugin(PlanProbe, config ?? {});
}
