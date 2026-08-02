/**
 * CODER — civilization & distributed commands (Phase 9).
 *
 *   coder civilization run <goal> | status        (alias: civ)
 *   coder director <name> <task>
 *   coder cluster status | cluster-status
 *   coder worker [--name] [--type agent|tool|memory|search] [--region] [--once]
 */

import { EXIT } from "../../core/constants/index.js";
import type { AppContext } from "../../core/application/application.js";
import { prepareRun } from "../_shared.js";
import { runCivilization } from "../../civilization/run.js";
import { getDirector, listDirectors, directorRole } from "../../civilization/directors.js";
import { ClusterManager, type WorkerType } from "../../runtime/cluster.js";
import { orchestrateTask } from "../../orchestration/pipeline.js";

const t = (ctx: AppContext) => ctx.theme;
const out = (s: string) => process.stdout.write(`${s}\n`);
const err = (s: string) => process.stderr.write(`${s}\n`);
const pad = (v: string, w: number) => (v.length > w ? `${v.slice(0, w - 1)}…` : v).padEnd(w);

export async function civilizationRunCommand(
  ctx: AppContext,
  opts: { goal: string; dir?: string; provider?: string; model?: string },
): Promise<number> {
  const { workspace, providerId, model } = await prepareRun(ctx, opts);
  out(`${t(ctx).bold}Civilization goal:${t(ctx).reset} ${opts.goal}`);
  const result = await runCivilization({
    goal: opts.goal,
    workspace,
    registry: ctx.registry,
    providerId,
    model,
    onStep: (s) => out(`${t(ctx).accent}▶ ${s.director.title}${t(ctx).reset} ${t(ctx).dim}(${s.director.layer})${t(ctx).reset}\n${t(ctx).muted}${s.output.slice(0, 240)}${t(ctx).reset}`),
  });
  out(`\n${t(ctx).bold}Allocated directors:${t(ctx).reset} ${result.allocated.map((d) => d.id).join(", ")}`);
  out(`${t(ctx).success}Score ${result.evaluation.score.toFixed(2)}${t(ctx).reset} · recorded ${result.knowledgeRecorded} knowledge item(s)`);
  out(result.summary);
  return EXIT.OK;
}

export async function civilizationStatusCommand(ctx: AppContext): Promise<number> {
  out(`${t(ctx).bold}Civilization directors:${t(ctx).reset}`);
  for (const d of listDirectors()) {
    out(`  ${t(ctx).accent}${pad(d.id, 12)}${t(ctx).reset} ${pad(d.title, 26)} ${t(ctx).dim}${d.layer}${t(ctx).reset} ${d.responsibility}`);
  }
  return EXIT.OK;
}

export async function directorCommand(
  ctx: AppContext,
  opts: { name: string; task: string; dir?: string; provider?: string; model?: string },
): Promise<number> {
  const director = getDirector(opts.name);
  if (!director) {
    err(`${t(ctx).error}Unknown director: ${opts.name}. Try: ${listDirectors().map((d) => d.id).join(", ")}${t(ctx).reset}`);
    return EXIT.USAGE;
  }
  const role = directorRole(director);
  if (!role) {
    err(`${t(ctx).error}Director "${opts.name}" has no backing agent role.${t(ctx).reset}`);
    return EXIT.ERROR;
  }
  const { workspace, providerId, model } = await prepareRun(ctx, opts);
  out(`${t(ctx).bold}${director.title}${t(ctx).reset} → ${opts.task}`);
  // Run a single-role orchestration by composing a one-step pipeline.
  const result = await orchestrateTask({
    task: opts.task,
    workspace,
    registry: ctx.registry,
    providerId,
    model,
    onStep: (s) => out(`${t(ctx).accent}▶ ${s.title}${t(ctx).reset}`),
  });
  const mine = result.steps.find((s) => s.role.id === role.id);
  out(mine ? mine.output : result.report);
  return EXIT.OK;
}

export async function clusterStatusCommand(ctx: AppContext): Promise<number> {
  const cluster = new ClusterManager();
  const s = cluster.summary();
  out(`${t(ctx).bold}Cluster${t(ctx).reset}`);
  out(`  controller: ${s.controllerOnline ? t(ctx).success + "online" : t(ctx).dim + "offline"}${t(ctx).reset}`);
  out(`  regions:    ${s.regions}`);
  out(`  workers:    ${s.workers} (${s.tasksRun} tasks run)`);
  const workers = cluster.listWorkers();
  if (workers.length) {
    out(`  nodes:`);
    for (const w of workers) out(`    ${pad(w.name, 16)} ${pad(w.type, 8)} ${pad(w.region, 10)} ${t(ctx).dim}${w.status} · ${w.tasksCompleted} done${t(ctx).reset}`);
  }
  return EXIT.OK;
}

export async function workerCommand(ctx: AppContext, opts: { name?: string; type?: WorkerType; region?: string; once?: boolean }): Promise<number> {
  const cluster = new ClusterManager();
  cluster.bringControllerOnline();
  const node = cluster.registerWorker({ name: opts.name, type: opts.type, region: opts.region });
  out(`${t(ctx).success}Registered worker:${t(ctx).reset} ${node.name} (${node.type}, region ${node.region}) → ${node.id}`);
  if (opts.once) {
    const ran = await cluster.runOnce(node.id);
    out(ran.ran ? `${t(ctx).success}Ran task:${t(ctx).reset} ${ran.taskId}` : `${t(ctx).dim}No queued tasks to run.${t(ctx).reset}`);
  }
  return EXIT.OK;
}
