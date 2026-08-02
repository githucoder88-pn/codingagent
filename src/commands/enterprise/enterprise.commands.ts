/**
 * CODER — enterprise commands (Phase 6).
 *
 *   coder org create|list|show|member|usage|security|billing|memory
 *   coder workspace create|list|start|stop|destroy
 *   coder runtime
 */

import { EXIT } from "../../core/constants/index.js";
import type { AppContext } from "../../core/application/application.js";
import { OrganizationManager, type WorkspaceEnv, type WorkspaceStatus } from "../../organizations/manager.js";
import { ClusterManager } from "../../runtime/cluster.js";

const t = (ctx: AppContext) => ctx.theme;
const out = (s: string) => process.stdout.write(`${s}\n`);
const err = (s: string) => process.stderr.write(`${s}\n`);
const pad = (v: string, w: number) => (v.length > w ? `${v.slice(0, w - 1)}…` : v).padEnd(w);

function mgr(): OrganizationManager {
  return new OrganizationManager();
}

function currentUserId(): string {
  return process.env.CODER_USER_ID ?? "local-user";
}

// ---------------------------------------------------------------- org
export async function orgCreateCommand(ctx: AppContext, opts: { name: string; plan?: string }): Promise<number> {
  const org = mgr().createOrg({ name: opts.name, ownerId: currentUserId(), email: "you@local", plan: opts.plan as never });
  out(`${t(ctx).success}Created organization:${t(ctx).reset} ${org.name} (${org.id}, plan ${org.plan})`);
  return EXIT.OK;
}

export async function orgListCommand(ctx: AppContext): Promise<number> {
  const orgs = mgr().listOrgs();
  if (orgs.length === 0) {
    out(`${t(ctx).dim}No organizations. Create one with \`coder org create <name>\`.${t(ctx).reset}`);
    return EXIT.OK;
  }
  out(`${t(ctx).bold}Organizations:${t(ctx).reset}`);
  for (const o of orgs) out(`  ${t(ctx).accent}${pad(o.name, 18)}${t(ctx).reset} ${pad(o.plan, 10)} ${t(ctx).dim}${o.members.length} members${t(ctx).reset} ${o.id}`);
  return EXIT.OK;
}

export async function orgShowCommand(ctx: AppContext, idOrName: string): Promise<number> {
  const org = mgr().getOrg(idOrName);
  if (!org) return notFound(ctx, "organization", idOrName);
  out(`${t(ctx).bold}${org.name}${t(ctx).reset} (${org.id}) · plan ${org.plan}`);
  out(`Members:`);
  for (const m of org.members) out(`  ${pad(m.email, 24)} ${t(ctx).dim}${m.role}${t(ctx).reset}`);
  if (org.sharedMemory.length) {
    out(`Shared memory (${org.sharedMemory.length}):`);
    for (const m of org.sharedMemory.slice(0, 10)) out(`  [${m.scope}] ${m.key} = ${m.value.slice(0, 60)}`);
  }
  return EXIT.OK;
}

export async function orgMemberCommand(ctx: AppContext, opts: { action: "add" | "remove"; org: string; email: string; role?: string }): Promise<number> {
  const m = mgr();
  const userId = `user:${opts.email}`;
  if (opts.action === "add") {
    const org = m.addMember(opts.org, { userId, email: opts.email, role: opts.role as never });
    if (!org) return notFound(ctx, "organization", opts.org);
    out(`${t(ctx).success}Added member:${t(ctx).reset} ${opts.email} → ${org.name}`);
  } else {
    const org = m.removeMember(opts.org, userId);
    if (!org) return notFound(ctx, "organization", opts.org);
    out(`${t(ctx).success}Removed member:${t(ctx).reset} ${opts.email} from ${org.name}`);
  }
  return EXIT.OK;
}

export async function orgMemoryCommand(ctx: AppContext, opts: { action: "store" | "list"; org: string; key?: string; value?: string; scope?: string }): Promise<number> {
  const m = mgr();
  if (opts.action === "store") {
    const org = m.storeSharedMemory(opts.org, { scope: opts.scope ?? "global", key: opts.key!, value: opts.value! });
    if (!org) return notFound(ctx, "organization", opts.org);
    out(`${t(ctx).success}Stored shared memory:${t(ctx).reset} [${opts.scope ?? "global"}] ${opts.key}`);
  } else {
    const org = m.getOrg(opts.org);
    if (!org) return notFound(ctx, "organization", opts.org);
    for (const mem of org.sharedMemory) out(`  [${mem.scope}] ${mem.key} = ${mem.value}`);
  }
  return EXIT.OK;
}

export async function orgUsageCommand(ctx: AppContext, idOrName: string): Promise<number> {
  const org = mgr().getOrg(idOrName);
  if (!org) return notFound(ctx, "organization", idOrName);
  const workspaces = mgr().listWorkspaces().filter((w) => w.orgId === org.id);
  out(`${t(ctx).bold}${org.name} usage:${t(ctx).reset}`);
  out(`  members:   ${org.members.length}`);
  out(`  memory:    ${org.sharedMemory.length} entries`);
  out(`  workspaces: ${workspaces.length}`);
  return EXIT.OK;
}

// --------------------------------------------------------- workspaces
export async function workspaceCreateCommand(ctx: AppContext, opts: { name: string; org?: string; environment?: WorkspaceEnv; region?: string }): Promise<number> {
  const m = mgr();
  const org = opts.org ? m.getOrg(opts.org) : undefined;
  const ws = m.createWorkspace({ name: opts.name, orgId: org?.id, ownerId: currentUserId(), environment: opts.environment, region: opts.region });
  out(`${t(ctx).success}Created workspace:${t(ctx).reset} ${ws.name} (${ws.id}) · ${ws.environment} · ${ws.status}`);
  return EXIT.OK;
}

export async function workspaceListCommand(ctx: AppContext): Promise<number> {
  const list = mgr().listWorkspaces();
  if (list.length === 0) {
    out(`${t(ctx).dim}No workspaces. Create one with \`coder workspace create <name>\`.${t(ctx).reset}`);
    return EXIT.OK;
  }
  out(`${t(ctx).bold}Workspaces:${t(ctx).reset}`);
  for (const w of list) out(`  ${t(ctx).accent}${pad(w.name, 18)}${t(ctx).reset} ${pad(w.environment, 16)} ${pad(w.status, 10)} ${t(ctx).dim}${w.region}${t(ctx).reset} ${w.id}`);
  return EXIT.OK;
}

export async function workspaceStartCommand(ctx: AppContext, id: string): Promise<number> {
  return workspaceLifecycle(ctx, id, "running", "Started");
}

export async function workspaceStopCommand(ctx: AppContext, id: string): Promise<number> {
  return workspaceLifecycle(ctx, id, "stopped", "Stopped");
}

export async function workspaceDestroyCommand(ctx: AppContext, id: string): Promise<number> {
  return workspaceLifecycle(ctx, id, "destroyed", "Destroyed");
}

async function workspaceLifecycle(ctx: AppContext, id: string, status: WorkspaceStatus, verb: string): Promise<number> {
  const ws = mgr().setWorkspaceStatus(id, status);
  if (!ws) return notFound(ctx, "workspace", id);
  out(`${t(ctx).success}${verb} workspace:${t(ctx).reset} ${ws.name} → ${ws.status}`);
  return EXIT.OK;
}

// ------------------------------------------------------------- runtime
export async function runtimeCommand(ctx: AppContext): Promise<number> {
  const cluster = new ClusterManager().summary();
  const orgs = mgr().listOrgs().length;
  const workspaces = mgr().listWorkspaces().length;
  out(`${t(ctx).bold}Runtime${t(ctx).reset}`);
  out(`  controller:    ${cluster.controllerOnline ? t(ctx).success + "online" : t(ctx).dim + "offline"}${t(ctx).reset}`);
  out(`  regions:       ${cluster.regions}`);
  out(`  workers:       ${cluster.workers} (${cluster.tasksRun} tasks run)`);
  out(`  organizations: ${orgs}`);
  out(`  workspaces:    ${workspaces}`);
  return EXIT.OK;
}

function notFound(ctx: AppContext, kind: string, id: string): number {
  err(`${t(ctx).error}${kind} not found: ${id}${t(ctx).reset}`);
  return EXIT.USAGE;
}
