import { Service } from "@deepseek-ai/cordis";
import { z } from "zod";

const KEY = "planRounds";
const ALLOWED = new Set([0, 2, 4]);

export const name = "plan-rounds";

export const Config = z.object({
  /** 默认轮数（0 = 关闭）。外部按钮/命令会覆盖它。 */
  defaultRounds: z.number().default(0),
  /** 注入 system prompt 的顺序位。 */
  sectionOrder: z.number().default(41),
  /** rounds = 会话内多轮计划；acceptance = 由外部规划子进程产出清单，主会话只执行 */
  mode: z.enum(["rounds", "acceptance"]).default("rounds"),
  /** acceptance 模式下要读的清单文件 */
  acceptanceFile: z.string().default("ACCEPTANCE.md")
});

function normalizeRounds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const clamped = n >= 4 ? 4 : n >= 2 ? 2 : 0;
  return ALLOWED.has(clamped) ? clamped : null;
}

const projection = {
  key: KEY,
  stateVersion: 1,
  stateSchema: z.object({ rounds: z.number().nullable(), lastSeq: z.number().nullable() }).strict(),
  init: () => ({ rounds: null, lastSeq: null }),
  apply: (state, event) => {
    if (event.type === "command/run" && event.data?.name === "plan-rounds") {
      const rounds = normalizeRounds(event.data.args);
      if (rounds === null) return state;
      return { rounds, lastSeq: event.seq ?? null };
    }
    return state;
  },
  wire: {
    viewSchema: z.object({ rounds: z.number() }),
    view: (state) => ({ rounds: state.rounds ?? 0 })
  }
};

function contract(rounds) {
  if (rounds === 0) return "";
  const plans = Array.from({ length: rounds }, (_, i) => `PLAN-v${i + 1}.md`).join(" → ");
  return [
    `PLANNING ROUNDS: ${rounds} (session setting; the user controls it with /plan-rounds 0|2|4).`,
    "Before writing any implementation code, produce the plan chain " + plans + " in the working directory, one file per round:",
    "- round 1: break the request into numbered deliverables and an initial acceptance list;",
    "- each later round: read the previous plan, act as a strict reviewer who rejects weak items, and rewrite it — every requirement must end up paired with a concrete, runnable check (command, assertion, or measurement);",
    "- if a requirement cannot be made checkable, say so explicitly instead of softening it.",
    "Then write ACCEPTANCE.md (the frozen checklist from the last plan) and implement.",
    "Before you claim completion, run every item in ACCEPTANCE.md and quote the observed result; list anything you could not verify as NOT DONE."
  ].join("\n");
}

function acceptanceContract(file) {
  return [
    `ACCEPTANCE-DRIVEN MODE: a planning subprocess has already frozen the checklist at ${file} in the working directory.`,
    `- Read ${file} first. Do NOT read PLAN-*.md: those are the planner notes, not your instructions.`,
    `- Implement the deliverable, then execute every acceptance item and record pass / fail / na / blocked`,
    '  with the observed evidence (command plus output) in ACCEPTANCE-RESULT.md.',
    '- Any item you cannot verify must be listed as NOT DONE. Never soften or silently drop an item.',
    '- If the checklist is missing or empty, say so and proceed without it.'
  ].join('\n');
}

class PlanRounds extends Service {
  static inject = ["systemPrompt", "sessionProjections"];

  constructor(ctx, config = {}) {
    super(ctx, "planRounds");
    const defaultRounds = normalizeRounds(config.defaultRounds) ?? 0;
    const sectionOrder = config.sectionOrder ?? 41;
    const mode = config.mode ?? "rounds";
    const acceptanceFile = config.acceptanceFile ?? "ACCEPTANCE.md";

    ctx.inject(["commands"], (commandCtx) => {
      commandCtx.commands.register({
        definitionId: "dsh-plan-rounds",
        name: "plan-rounds",
        description: "Set how many planning rounds run before implementation (0 = off, 2 = on, 4 = enhanced)",
        input: { hint: "[0|2|4]" },
        handler: ({ rawInput }) => {
          const rounds = normalizeRounds(rawInput?.trim() ?? "");
          if (rounds === null) {
            return { kind: "error", text: "Usage: /plan-rounds 0 | 2 | 4" };
          }
          const label = rounds === 0 ? "off" : rounds === 2 ? "on (2 rounds)" : "enhanced (4 rounds)";
          return { kind: "success", text: `Planning rounds: ${label} — applies from your next turn.` };
        }
      });
    });

    ctx.sessionProjections.register(projection);

    ctx.systemPrompt.section({
      name: "plan-rounds:contract",
      order: sectionOrder,
      text: (context) => {
        if (mode === "acceptance") return acceptanceContract(acceptanceFile);
        const agent = context.agent;
        if (agent === undefined) return contract(defaultRounds);
        const state = this.ctx.sessionProjections.stateOf(agent.session, KEY);
        const rounds = state?.rounds ?? defaultRounds;
        return contract(rounds);
      }
    });
  }
}

export function apply(ctx, config) {
  if (process.env.DSH_PLAN_ROUNDS_DEBUG === "1") {
    process.stderr.write("[plan-rounds] apply config=" + JSON.stringify(config ?? {}) + "\n");
  }
  ctx.plugin(PlanRounds, config ?? {});
}