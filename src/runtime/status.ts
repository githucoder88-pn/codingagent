/**
 * CODER — runtime status (Phase 11).
 *
 * `coder status [--json]` aggregates every subsystem into one view:
 *   Mode · Backend (health probe incl. version) · Session · Memory ·
 *   Pet (daemon) · Sync outbox · queued/failed tasks · connected workspaces.
 *
 * Every probe is best-effort and non-blocking so a partly-offline runtime
 * still renders a full panel.
 */

import { EXIT } from "../core/constants/index.js";
import type { AppContext } from "../core/application/application.js";
import { DaemonManager } from "../pet/daemon.js";
import { SyncOutbox } from "../offline/outbox.js";
import { TaskQueue } from "../tasks/queue.js";
import { ConnectionManager } from "../offline/connect.js";
import { ScopedMemory, type MemoryScope } from "../session/memory/scoped.js";

export interface StatusReport {
  offline: boolean;
  mode: string;
  backend: { reachable: boolean; version?: string; url: string };
  session: { current?: string };
  memory: Record<MemoryScope, number> & { total: number };
  pet: { running: boolean; pid?: number; autonomous: boolean };
  outbox: { pending: number };
  tasks: { queued: number; failed: number };
  workspaces: { connected: number; pending: number };
}

export async function probeBackend(url: string, offline: boolean): Promise<{ reachable: boolean; version?: string }> {
  if (offline) return { reachable: false };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${url}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { reachable: false };
    const body = (await res.json()) as { version?: string };
    return { reachable: true, version: body.version };
  } catch {
    return { reachable: false };
  }
}

export async function buildStatus(ctx: AppContext, opts: { offline?: boolean; backendUrl?: string } = {}): Promise<StatusReport> {
  const url = opts.backendUrl ?? `http://127.0.0.1:${process.env.CODER_API_PORT ?? 8747}`;
  const backend = await probeBackend(url, !!opts.offline);

  let currentSession: string | undefined;
  try {
    currentSession = ctx.history.currentId();
  } catch {
    /* no session yet */
  }

  const memory = new ScopedMemory();
  const memCounts = {
    session: memory.read("session").entries.length,
    project: memory.read("project").entries.length,
    user: memory.read("user").entries.length,
    global: memory.read("global").entries.length,
  };

  const pet = new DaemonManager().status();
  const outbox = new SyncOutbox().pending().length;
  const taskStats = new TaskQueue().stats();
  const conns = new ConnectionManager().list();

  return {
    offline: !!opts.offline,
    mode: opts.offline ? "offline" : "local",
    backend: { reachable: backend.reachable, version: backend.version, url },
    session: { current: currentSession },
    memory: { ...memCounts, total: memCounts.session + memCounts.project + memCounts.user + memCounts.global },
    pet: { running: pet.running, pid: pet.pid, autonomous: pet.autonomous },
    outbox: { pending: outbox },
    tasks: { queued: taskStats.queued, failed: taskStats.failed },
    workspaces: { connected: conns.filter((c) => c.status === "connected").length, pending: conns.filter((c) => c.status === "pending").length },
  };
}

/** Render a StatusReport as human-readable lines. */
export function renderStatus(report: StatusReport): string {
  const lines: string[] = [];
  lines.push(`Mode:        ${report.mode}${report.offline ? " (offline)" : ""}`);
  lines.push(`Backend:     ${report.backend.reachable ? `reachable · v${report.backend.version ?? "?"}` : "unreachable"} (${report.backend.url})`);
  lines.push(`Session:     ${report.session.current ?? "(none)"}`);
  lines.push(`Memory:      ${report.memory.total} entries (session ${report.memory.session} · project ${report.memory.project} · user ${report.memory.user} · global ${report.memory.global})`);
  lines.push(`Pet:         ${report.pet.running ? `running (pid ${report.pet.pid})` : "stopped"}${report.pet.autonomous ? " · autonomous" : ""}`);
  lines.push(`Sync outbox: ${report.outbox.pending} pending`);
  lines.push(`Tasks:       ${report.tasks.queued} queued · ${report.tasks.failed} failed`);
  lines.push(`Workspaces:  ${report.workspaces.connected} connected · ${report.workspaces.pending} pending`);
  return lines.join("\n");
}

export { EXIT };
