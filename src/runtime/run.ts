/**
 * CODER — runtime task dispatcher (Phase 5 / 11).
 *
 * `coder run <task> --mode local|hybrid|cloud|agent|enterprise|organization|offline`
 *
 * Behaviour:
 *   - offline          → never touch the network; execute locally.
 *   - cloud/enterprise/organization → probe the backend; if unreachable,
 *     gracefully degrade to local execution and park the task in the sync
 *     outbox (Phase 11 core philosophy: the backend is optional).
 *   - local/hybrid/agent → execute locally via the agent loop.
 */

import { type ProviderRegistry } from "../providers/registry.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { ExecutionScheduler } from "../execution/scheduler.js";
import { runAgent } from "../execution/agent.js";
import { type PermissionLevel } from "../workspace/types.js";
import { ExecutionMode, type ExecutionModeId, modeIsOffline, modeRequiresBackend } from "./modes.js";
import { SyncOutbox } from "../offline/outbox.js";
import { probeBackend } from "./status.js";

export interface RunOptions {
  task: string;
  dir: string;
  registry: ProviderRegistry;
  providerId: string;
  model: string;
  mode: ExecutionModeId;
  level?: PermissionLevel;
  backendUrl?: string;
  onStep?: (step: { kind: "tool" | "message" | "error" | "info"; text: string; toolId?: string }) => void;
}

export interface RunResult {
  answer: string;
  iterations: number;
  toolCalls: number;
  finished: boolean;
  modeUsed: ExecutionModeId;
  degraded: boolean;
  parked: boolean;
}

export async function runTask(opts: RunOptions): Promise<RunResult> {
  let modeUsed = opts.mode;
  let degraded = false;
  let parked = false;

  // Cloud/enterprise/organization: probe backend, degrade if unreachable.
  if (modeRequiresBackend(opts.mode) && !modeIsOffline(opts.mode)) {
    const url = opts.backendUrl ?? `http://127.0.0.1:${process.env.CODER_API_PORT ?? 8747}`;
    const probe = await probeBackend(url, false);
    if (!probe.reachable) {
      degraded = true;
      modeUsed = ExecutionMode.LOCAL;
      new SyncOutbox().enqueue("task", { task: opts.task, mode: opts.mode });
      parked = true;
      opts.onStep?.({ kind: "info", text: `Backend unreachable — degraded to local; task parked in sync outbox.` });
    }
  }

  const workspace = new WorkspaceManager({ root: opts.dir });
  await workspace.ensureIndex();

  const scheduler = new ExecutionScheduler({
    cwd: opts.dir,
    level: opts.level ?? "balanced",
    interactive: false,
    log: () => {},
  });

  const result = await runAgent({
    task: opts.task,
    workspace,
    registry: opts.registry,
    providerId: opts.providerId,
    model: opts.model,
    scheduler,
    onStep: (step) => opts.onStep?.({ kind: step.kind, text: step.text, toolId: step.toolId }),
  });

  return {
    answer: result.answer,
    iterations: result.iterations,
    toolCalls: result.toolCalls,
    finished: result.finished,
    modeUsed,
    degraded,
    parked,
  };
}
