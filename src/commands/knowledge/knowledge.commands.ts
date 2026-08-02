/**
 * CODER — knowledge & model intelligence commands (Phase 8).
 *
 *   coder knowledge graph [--dir] | stats | search <q>
 *   coder model benchmark [--provider] [--model] [--all] [--json]
 */

import { EXIT } from "../../core/constants/index.js";
import type { AppContext } from "../../core/application/application.js";
import { KnowledgeGraph } from "../../knowledge/graph.js";
import { ModelRouter, classifyModel, estimateCost } from "../../providers/router.js";
import { WorkspaceManager } from "../../workspace/workspace-manager.js";

const t = (ctx: AppContext) => ctx.theme;
const out = (s: string) => process.stdout.write(`${s}\n`);
const err = (s: string) => process.stderr.write(`${s}\n`);

export async function knowledgeGraphCommand(ctx: AppContext, opts: { dir?: string }): Promise<number> {
  const root = opts.dir ?? process.cwd();
  const workspace = new WorkspaceManager({ root });
  const idx = await workspace.ensureIndex();
  const { added, reinforced } = new KnowledgeGraph().rebuildFromIndex(idx);
  out(`${t(ctx).success}Knowledge graph rebuilt:${t(ctx).reset} ${added} added · ${reinforced} reinforced from ${idx.root}`);
  return EXIT.OK;
}

export async function knowledgeStatsCommand(ctx: AppContext): Promise<number> {
  const stats = new KnowledgeGraph().stats();
  out(`${t(ctx).bold}Knowledge graph${t(ctx).reset} — ${stats.entities} entities, total weight ${stats.weight.toFixed(1)}${stats.rebuiltAt ? ` · rebuilt ${stats.rebuiltAt}` : ""}`);
  for (const [kind, n] of Object.entries(stats.byKind)) out(`  ${t(ctx).accent}${kind.padEnd(12)}${t(ctx).reset} ${n}`);
  return EXIT.OK;
}

export async function knowledgeSearchCommand(ctx: AppContext, query: string): Promise<number> {
  const results = new KnowledgeGraph().search(query);
  if (results.length === 0) {
    out(`${t(ctx).dim}No knowledge matched "${query}".${t(ctx).reset}`);
    return EXIT.OK;
  }
  out(`${t(ctx).bold}${results.length} knowledge match(es):${t(ctx).reset}`);
  for (const e of results.slice(0, 20)) out(`  ${t(ctx).accent}[${e.kind}]${t(ctx).reset} ${e.name} ${t(ctx).dim}w=${e.weight.toFixed(1)}${t(ctx).reset}`);
  return EXIT.OK;
}

export async function modelBenchmarkCommand(
  ctx: AppContext,
  opts: { provider?: string; model?: string; all?: boolean; json?: boolean },
): Promise<number> {
  const router = new ModelRouter(ctx.registry);
  let results;
  try {
    if (opts.model) {
      const providerId = opts.provider ?? ctx.settings().provider;
      results = [await router.benchmark(providerId, opts.model)];
    } else if (opts.all || opts.provider) {
      results = await router.benchmarkAll({ provider: opts.provider });
    } else {
      // default: benchmark the active provider's default model
      const providerId = ctx.settings().provider;
      const provider = ctx.registry.get(providerId);
      results = [await router.benchmark(providerId, provider.defaultModel)];
    }
  } catch (e) {
    err(`${t(ctx).error}Benchmark failed: ${(e as Error).message}${t(ctx).reset}`);
    return EXIT.ERROR;
  }

  if (opts.json) {
    out(JSON.stringify(results, null, 2));
    return EXIT.OK;
  }
  out(`${t(ctx).bold}Model benchmark${t(ctx).reset}`);
  for (const r of results) {
    const status = r.ok ? `${t(ctx).success}ok${t(ctx).reset}` : `${t(ctx).error}fail${t(ctx).reset}`;
    out(`  ${t(ctx).accent}${pad(r.providerId + "/" + r.modelId, 36)}${t(ctx).reset} ${pad(r.cls, 10)} ${status} ${r.latencyMs}ms · $${r.costPer1k.toFixed(5)}/1k`);
  }
  return EXIT.OK;
}

/** Print a single model's classification + cost estimate (`coder model info`). */
export async function modelInfoCommand(ctx: AppContext, modelId: string, opts: { json?: boolean }): Promise<number> {
  const cls = classifyModel(modelId);
  const sampleCost = estimateCost(modelId, 1000, 500);
  const info = { model: modelId, class: cls, estCostPer1500tokens: sampleCost };
  if (opts.json) out(JSON.stringify(info, null, 2));
  else out(`${t(ctx).bold}${modelId}${t(ctx).reset} → ${t(ctx).accent}${cls}${t(ctx).reset} · ~$${sampleCost.toFixed(5)}/1.5k tokens`);
  return EXIT.OK;
}

function pad(v: string, w: number): string {
  return (v.length > w ? `${v.slice(0, w - 1)}…` : v).padEnd(w);
}
