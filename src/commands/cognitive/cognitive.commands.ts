/**
 * CODER — cognitive commands (Phase 5 / 7).
 *
 *   coder cognitive status
 *   coder evolve <task>
 *   coder research <topic>
 */

import { EXIT } from "../../core/constants/index.js";
import type { AppContext } from "../../core/application/application.js";
import { prepareRun } from "../_shared.js";
import { cognitive } from "../../cognitive/core.js";
import { evolveTask, researchTopic } from "../../cognitive/loops.js";

const t = (ctx: AppContext) => ctx.theme;
const out = (s: string) => process.stdout.write(`${s}\n`);

export async function cognitiveStatusCommand(ctx: AppContext): Promise<number> {
  const s = cognitive().snapshot();
  out(`${t(ctx).bold}Cognitive core${t(ctx).reset}`);
  out(`  risk threshold: ${t(ctx).accent}${s.riskThreshold.toFixed(2)}${t(ctx).reset}`);
  out(`  reflections:    ${s.reflections.length} (${s.reflections.filter((r) => r.outcome === "success").length} success)`);
  out(`  lessons:        ${s.lessons.length}`);
  out(`  predictions:    ${s.predictions.length}`);
  if (s.worldModel.lastRoot) out(`  world model:    ${s.worldModel.entities} entities @ ${s.worldModel.lastRoot}`);
  out(`  step weights:`);
  for (const [role, w] of Object.entries(s.stepWeights)) out(`    ${t(ctx).dim}${role.padEnd(12)}${t(ctx).reset} ${w.toFixed(2)}`);
  return EXIT.OK;
}

export async function evolveCommand(
  ctx: AppContext,
  opts: { task: string; dir?: string; provider?: string; model?: string },
): Promise<number> {
  const { workspace, providerId, model } = await prepareRun(ctx, opts);
  out(`${t(ctx).bold}Evolving:${t(ctx).reset} ${opts.task}`);
  const result = await evolveTask({ task: opts.task, workspace, registry: ctx.registry, providerId, model });
  out(`${t(ctx).dim}confidence ${result.confidence.toFixed(2)} · risk ${result.riskThresholdBefore.toFixed(2)}→${result.riskThresholdAfter.toFixed(2)}${t(ctx).reset}`);
  out(`${t(ctx).bold}Plan:${t(ctx).reset}`);
  for (const step of result.steps) out(`  • ${step}`);
  out(`${t(ctx).success}Outcome: ${result.outcome}${t(ctx).reset}`);
  out(result.summary);
  return EXIT.OK;
}

export async function researchCommand(
  ctx: AppContext,
  opts: { topic: string; dir?: string; provider?: string; model?: string },
): Promise<number> {
  const { workspace, providerId, model } = await prepareRun(ctx, opts);
  out(`${t(ctx).bold}Researching:${t(ctx).reset} ${opts.topic}`);
  const result = await researchTopic({ topic: opts.topic, workspace, registry: ctx.registry, providerId, model });
  if (result.symbols.length) out(`${t(ctx).accent}Symbols:${t(ctx).reset}\n${result.symbols.map((s) => `  ${s}`).join("\n")}`);
  if (result.files.length) out(`${t(ctx).accent}Files:${t(ctx).reset}\n${result.files.map((s) => `  ${s}`).join("\n")}`);
  if (result.commits.length) out(`${t(ctx).accent}Commits:${t(ctx).reset}\n${result.commits.map((s) => `  ${s}`).join("\n")}`);
  out(`\n${t(ctx).bold}Summary:${t(ctx).reset}\n${result.summary}`);
  return EXIT.OK;
}
