import { Service } from "@deepseek-ai/cordis";
import { z } from "zod";
import fs from "node:fs";

const KEY = "planScope";

const projection = {
  key: KEY,
  stateVersion: 1,
  stateSchema: z.object({ turns: z.number() }).strict(),
  init: () => ({ turns: 0 }),
  apply: (state, event) => (event.type === "turn/start" ? { turns: state.turns + 1 } : state),
  wire: { viewSchema: z.object({ turns: z.number() }), view: (s) => ({ turns: s.turns }) }
};

class PlanScope extends Service {
  static inject = ["systemPrompt", "sessionProjections"];

  constructor(ctx, config = {}) {
    super(ctx, "planScope");
    const scope = process.env.PLAN_SCOPE || config.scope || "always";
    const file = process.env.PLAN_ACCEPTANCE_FILE || config.acceptanceFile || "ACCEPTANCE.md";
    const order = config.sectionOrder ?? 42;

    ctx.sessionProjections.register(projection);

    ctx.systemPrompt.section({
      name: "plan-scope:acceptance",
      order,
      text: (context) => {
        const agent = context.agent;
        const turns = agent ? (this.ctx.sessionProjections.stateOf(agent.session, KEY)?.turns ?? 0) : 0;
        if (scope === "first" && turns > 1) return "";
        let body = "";
        try {
          body = fs.readFileSync(file, "utf8");
        } catch {
          return "";
        }
        return "ACCEPTANCE (scope=" + scope + ")\n" + body;
      }
    });
  }
}

export function apply(ctx, config) {
  try { fs.writeFileSync("/tmp/plan-scope-loaded.txt", JSON.stringify(config ?? {})); } catch {}
  if (process.env.DSH_PLAN_SCOPE_DEBUG === "1") process.stderr.write("[plan-scope] apply " + JSON.stringify(config ?? {}) + "\n");
  ctx.plugin(PlanScope, config ?? {});
}
