/**
 * CODER — offline-first runtime commands (Phase 11).
 *
 *   coder run <task> --mode local|hybrid|cloud|agent|enterprise|organization|offline
 *   coder pet [--autonomous]            coder daemon start|status|stop
 *   coder restore [id]                  coder status [--json]
 *   coder connect workspace <id>|list|remove
 *   coder sync --flush                  coder recover
 */

import { EXIT } from "../../core/constants/index.js";
import type { AppContext } from "../../core/application/application.js";
import { runTask } from "../../runtime/run.js";
import { parseMode } from "../../runtime/modes.js";
import { buildStatus, renderStatus } from "../../runtime/status.js";
import { DaemonManager, PET_IDLE_MESSAGE } from "../../pet/daemon.js";
import { RecoveryEngine } from "../../offline/recovery.js";
import { ConnectionManager } from "../../offline/connect.js";
import { SyncOutbox } from "../../offline/outbox.js";
import { ScopedMemory } from "../../session/memory/scoped.js";

const t = (ctx: AppContext) => ctx.theme;
const out = (s: string) => process.stdout.write(`${s}\n`);
const err = (s: string) => process.stderr.write(`${s}\n`);

// ------------------------------------------------------------------ run
export async function runCommand(
  ctx: AppContext,
  opts: { task: string; dir?: string; mode?: string; provider?: string; model?: string; offline?: boolean },
): Promise<number> {
  const dir = opts.dir ?? process.cwd();
  const settings = ctx.settings();
  const providerId = opts.provider ?? settings.provider;
  const { provider, model } = ctx.registry.resolve(providerId, opts.model ?? settings.model);

  const mode = parseMode(opts.mode ?? (opts.offline ? "offline" : "local"));
  if (provider.requiresKey && !ctx.config.getAccount(provider.id)) {
    // Offline-first: fall back to the mock provider rather than hard-failing.
    err(`${t(ctx).warning}Provider "${provider.id}" not configured — using the offline mock provider.${t(ctx).reset}`);
  }

  out(`${t(ctx).bold}Run:${t(ctx).reset} ${opts.task} ${t(ctx).dim}(mode ${mode}, ${provider.id}/${model})${t(ctx).reset}`);
  const result = await runTask({
    task: opts.task,
    dir,
    registry: ctx.registry,
    providerId: provider.id,
    model,
    mode,
    onStep: (step) => {
      if (step.kind === "tool") out(`${t(ctx).accent}→ ${step.text.slice(0, 150)}${t(ctx).reset}`);
      else if (step.kind === "error") out(`${t(ctx).warning}⚠ ${step.text.slice(0, 180)}${t(ctx).reset}`);
      else if (step.kind === "info") out(`${t(ctx).dim}${step.text}${t(ctx).reset}`);
    },
  });

  if (result.degraded) out(`${t(ctx).warning}Degraded to local mode; task parked in sync outbox.${t(ctx).reset}`);
  out(`\n${t(ctx).bold}Result${t(ctx).reset} (${result.iterations} steps, ${result.toolCalls} tool calls):\n${result.answer}`);
  return result.finished ? EXIT.OK : EXIT.ERROR;
}

// ------------------------------------------------------------- pet/daemon
export async function petCommand(ctx: AppContext, opts: { autonomous?: boolean; dir?: string }): Promise<number> {
  if (opts.autonomous) {
    // Recovery pass + background sync, then idle.
    const recovery = new RecoveryEngine().recover();
    out(`${t(ctx).dim}recovery: ${recovery.recovered.length} re-queued, ${recovery.skipped} skipped${t(ctx).reset}`);
    const flushed = await new SyncOutbox().flush(async () => false);
    out(`${t(ctx).dim}sync: ${flushed.delivered} delivered, ${flushed.deferred} deferred (offline)${t(ctx).reset}`);
  }
  out(PET_IDLE_MESSAGE);
  return EXIT.OK;
}

export async function daemonStartCommand(ctx: AppContext, opts: { dir?: string; autonomous?: boolean }): Promise<number> {
  const state = new DaemonManager().start({ workspace: opts.dir, autonomous: opts.autonomous });
  out(`${t(ctx).success}Daemon:${t(ctx).reset} ${state.pid ? `started (pid ${state.pid})` : "registered (no detached pet spawned)"}`);
  return EXIT.OK;
}

export async function daemonStatusCommand(ctx: AppContext): Promise<number> {
  const mgr = new DaemonManager();
  const s = mgr.status();
  out(`${t(ctx).bold}Daemon${t(ctx).reset} ${s.running ? `${t(ctx).success}running${t(ctx).reset} (pid ${s.pid})` : `${t(ctx).dim}stopped${t(ctx).reset}`}${s.autonomous ? " · autonomous" : ""}`);
  if (s.workspace) out(`  workspace: ${s.workspace}`);
  out(`  log: ${s.logFile}`);
  const tail = mgr.logTail(5);
  if (tail) out(`${t(ctx).dim}--- log tail ---${t(ctx).reset}\n${tail}`);
  return EXIT.OK;
}

export async function daemonStopCommand(ctx: AppContext): Promise<number> {
  const res = await new DaemonManager().stop();
  out(`${t(ctx).success}Daemon stopped${t(ctx).reset}${res.forced ? " (SIGKILL)" : ""}`);
  return EXIT.OK;
}

// --------------------------------------------------------------- restore
export async function restoreCommand(ctx: AppContext, id?: string): Promise<number> {
  const targetId = id ?? ctx.history.currentId();
  if (!targetId) {
    err(`${t(ctx).error}No session to restore.${t(ctx).reset}`);
    return EXIT.USAGE;
  }
  const session = ctx.sessions.load(targetId);
  if (!session) return notFound(ctx, "session", targetId);
  ctx.history.setCurrent(session.id);
  out(`${t(ctx).success}Restored session:${t(ctx).reset} ${session.id} (${session.messages.length} messages)`);
  return EXIT.OK;
}

// ---------------------------------------------------------------- status
export async function statusCommand(ctx: AppContext, opts: { json?: boolean; offline?: boolean }): Promise<number> {
  const report = await buildStatus(ctx, { offline: opts.offline });
  if (opts.json) {
    out(JSON.stringify(report, null, 2));
    return EXIT.OK;
  }
  out(renderStatus(report));
  return EXIT.OK;
}

// --------------------------------------------------------------- connect
export async function connectCommand(ctx: AppContext, opts: { action: "workspace" | "list" | "remove"; id?: string; label?: string }): Promise<number> {
  const mgr = new ConnectionManager();
  if (opts.action === "list") {
    const list = mgr.list();
    if (list.length === 0) out(`${t(ctx).dim}No workspace connections.${t(ctx).reset}`);
    for (const c of list) out(`  ${t(ctx).accent}${pad(c.workspaceId, 12)}${t(ctx).reset} ${pad(c.status, 10)} ${c.label}`);
    return EXIT.OK;
  }
  if (opts.action === "remove") {
    if (!opts.id) return usage(ctx, "connect remove <id>");
    const removed = mgr.remove(opts.id);
    out(removed ? `${t(ctx).success}Removed connection:${t(ctx).reset} ${opts.id}` : `${t(ctx).dim}No connection for ${opts.id}.${t(ctx).reset}`);
    return EXIT.OK;
  }
  // workspace <id>
  if (!opts.id) return usage(ctx, "connect workspace <id>");
  const conn = mgr.connect(opts.id, opts.label);
  out(`${t(ctx).success}Connection recorded:${t(ctx).reset} ${conn.workspaceId} (${conn.status})`);
  return EXIT.OK;
}

// ----------------------------------------------------------- sync flush
export async function syncFlushCommand(ctx: AppContext): Promise<number> {
  const outbox = new SyncOutbox();
  const before = outbox.pending().length;
  const { delivered, deferred } = await outbox.flush(async () => {
    try {
      const url = `http://127.0.0.1:${process.env.CODER_API_PORT ?? 8747}/api/health`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  });
  out(`${t(ctx).success}Sync outbox flushed:${t(ctx).reset} ${delivered} delivered, ${deferred} deferred of ${before} pending`);
  return EXIT.OK;
}

export async function recoverCommand(ctx: AppContext): Promise<number> {
  const { recovered, skipped } = new RecoveryEngine().recover();
  out(`${t(ctx).success}Recovery pass:${t(ctx).reset} ${recovered.length} re-queued, ${skipped} skipped (already retried)`);
  return EXIT.OK;
}

// ----------------------------------------------------------- offline probe
/** Memory scope helper exposed for the Ink panel (Phase 11). */
export function memoryTotals(): Record<string, number> {
  const m = new ScopedMemory();
  return {
    session: m.read("session").entries.length,
    project: m.read("project").entries.length,
    user: m.read("user").entries.length,
    global: m.read("global").entries.length,
  };
}

// ------------------------------------------------------------- helpers
function notFound(ctx: AppContext, kind: string, id: string): number {
  err(`${t(ctx).error}${kind} not found: ${id}${t(ctx).reset}`);
  return EXIT.USAGE;
}
function usage(ctx: AppContext, msg: string): number {
  err(`${t(ctx).error}Usage: coder ${msg}${t(ctx).reset}`);
  return EXIT.USAGE;
}
function pad(v: string, w: number): string {
  return (v.length > w ? `${v.slice(0, w - 1)}…` : v).padEnd(w);
}
