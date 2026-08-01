/**
 * CODER — `coder agent <task>`.
 *
 * Runs the autonomous agent loop against the workspace: builds context,
 * calls the model with the tool-use protocol, executes tool calls through
 * the permission-gated scheduler, and iterates until completion.
 */

import { WorkspaceManager } from "../../workspace/workspace-manager.js";
import { ExecutionScheduler } from "../../execution/scheduler.js";
import { runAgent } from "../../execution/agent.js";
import { syncPatchToBackend } from "../../sync/workspace-sync.js";
import { computeDiff } from "../../tools/patch.js";
import type { AppContext } from "../../core/application/application.js";
import type { PermissionLevel } from "../../workspace/types.js";

export interface AgentCommandOptions {
  task: string;
  dir?: string;
  level: PermissionLevel;
  provider?: string;
  model?: string;
  noSync?: boolean;
}

export async function agentCommand(ctx: AppContext, opts: AgentCommandOptions): Promise<number> {
  const { theme, logger } = ctx;
  const root = opts.dir ?? process.cwd();

  const workspace = new WorkspaceManager({ root });
  await workspace.ensureIndex();

  const settings = ctx.settings();
  const providerId = opts.provider ?? settings.provider;
  const { provider, model } = ctx.registry.resolve(providerId, opts.model ?? settings.model);
  if (provider.requiresKey && !ctx.config.getAccount(provider.id)) {
    process.stderr.write(
      `${theme.error}Provider "${provider.id}" is not configured. Run \`coder auth add ${provider.id}\` first (or use the mock provider offline).${theme.reset}\n`,
    );
    return 3;
  }

  const scheduler = new ExecutionScheduler({
    cwd: root,
    level: opts.level,
    interactive: process.stdin.isTTY === true,
    log: (msg) => logger.debug(msg),
  });

  process.stdout.write(`${theme.bold}Agent task:${theme.reset} ${opts.task}\n`);
  process.stdout.write(`${theme.dim}Workspace: ${root} · provider: ${provider.id}/${model} · level: ${opts.level}${theme.reset}\n`);

  const result = await runAgent({
    task: opts.task,
    workspace,
    registry: ctx.registry,
    providerId: provider.id,
    model,
    scheduler,
    onStep: (step) => {
      if (step.kind === "tool") {
        process.stdout.write(`${theme.accent}→ ${step.text.slice(0, 160)}${theme.reset}\n`);
      } else if (step.kind === "error") {
        process.stdout.write(`${theme.warning}⚠ ${step.text.slice(0, 200)}${theme.reset}\n`);
      } else {
        process.stdout.write(`${theme.success}✓ ${step.text.slice(0, 200)}${theme.reset}\n`);
      }
    },
  });

  process.stdout.write(`\n${theme.bold}Result (${result.iterations} steps, ${result.toolCalls} tool calls):${theme.reset}\n${result.answer}\n`);

  // Record the resulting patch to the backend (best-effort).
  if (!opts.noSync) {
    try {
      const records = scheduler.historyEntries().filter((r) => r.touched.length > 0);
      if (records.length > 0 && records[0]?.touched[0]) {
        const { ExecutionLedger } = await import("../../execution/ledger.js");
        const ledger = new ExecutionLedger(root);
        const recent = ledger.recentMutating(5);
        const first = recent[0];
        if (first?.snapshot !== undefined && first.touched[0]) {
          const { readFileSync } = await import("node:fs");
          const { join } = await import("node:path");
          try {
            const after = readFileSync(join(root, first.touched[0]), "utf8");
            const diff = computeDiff(first.touched[0], first.snapshot, after);
            await syncPatchToBackend(ctx, root, opts.task.slice(0, 200), diff);
          } catch {
            /* best effort */
          }
        }
      }
    } catch {
      /* best effort */
    }
  }
  return result.finished ? 0 : 1;
}
