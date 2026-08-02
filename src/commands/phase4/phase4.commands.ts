/**
 * CODER — Phase 4 command handlers.
 *
 * Multi-agent orchestration (`plan`, `orchestrate`, `agent`), workflows,
 * MCP servers, extensions, skills and the task queue. Each handler returns
 * an exit code (0 ok, 2 usage, 1 error) consistent with the rest of the CLI.
 */

import { EXIT } from "../../core/constants/index.js";
import type { AppContext } from "../../core/application/application.js";
import { prepareRun } from "../_shared.js";
import { planTask, orchestrateTask } from "../../orchestration/pipeline.js";
import { WorkflowManager } from "../../orchestration/workflows.js";
import { getAgentRole, listAgentRoles } from "../../orchestration/roles.js";
import { McpManager } from "../../mcp/manager.js";
import { ExtensionManager } from "../../extensions/manager.js";
import { SkillManager } from "../../skills/manager.js";
import { TaskQueue } from "../../tasks/queue.js";

const t = (ctx: AppContext) => ctx.theme;
const out = (s: string) => process.stdout.write(`${s}\n`);
const err = (s: string) => process.stderr.write(`${s}\n`);

// ---------------------------------------------------------------- roles
export async function rolesCommand(ctx: AppContext): Promise<number> {
  out(`${t(ctx).bold}Agent roles:${t(ctx).reset}`);
  for (const role of listAgentRoles()) {
    out(`  ${t(ctx).accent}${pad(role.id, 12)}${t(ctx).reset} ${t(ctx).dim}${pad(role.title, 18)}${t(ctx).reset} ${role.responsibility}`);
  }
  return EXIT.OK;
}

// ------------------------------------------------------------ orchestrate
export async function orchestrateCommand(
  ctx: AppContext,
  opts: { task: string; dir?: string; provider?: string; model?: string },
): Promise<number> {
  const { workspace, providerId, model } = await prepareRun(ctx, opts);
  out(`${t(ctx).bold}Orchestrating:${t(ctx).reset} ${opts.task}`);
  const result = await orchestrateTask({
    task: opts.task,
    workspace,
    registry: ctx.registry,
    providerId,
    model,
    onStep: (s) => out(`${t(ctx).accent}▶ ${s.title}${t(ctx).reset} ${t(ctx).dim}(${s.role})${t(ctx).reset}\n${t(ctx).muted}${s.text.slice(0, 280)}${t(ctx).reset}`),
  });
  out(`\n${t(ctx).bold}Report${t(ctx).reset} (${result.steps.length} roles, ${result.durationMs}ms):\n${result.report}`);
  return EXIT.OK;
}

export async function planCommand(
  ctx: AppContext,
  opts: { task: string; dir?: string; provider?: string; model?: string },
): Promise<number> {
  const { workspace, providerId, model } = await prepareRun(ctx, opts);
  out(`${t(ctx).bold}Planning:${t(ctx).reset} ${opts.task}`);
  const result = await planTask({ task: opts.task, workspace, registry: ctx.registry, providerId, model });
  out(result.report);
  return EXIT.OK;
}

// ------------------------------------------------------------- workflows
export async function workflowListCommand(ctx: AppContext): Promise<number> {
  const mgr = new WorkflowManager();
  out(`${t(ctx).bold}Workflows:${t(ctx).reset}`);
  for (const wf of mgr.list()) {
    out(`  ${t(ctx).accent}${pad(wf.name, 14)}${t(ctx).reset} ${t(ctx).dim}${wf.steps.length} steps${t(ctx).reset} ${wf.description}`);
  }
  return EXIT.OK;
}

export async function workflowInstallCommand(ctx: AppContext, opts: { name: string; steps: string[]; description?: string }): Promise<number> {
  const invalid = opts.steps.filter((s) => !getAgentRole(s));
  if (invalid.length > 0) {
    err(`${t(ctx).error}Unknown role(s): ${invalid.join(", ")}${t(ctx).reset}`);
    return EXIT.USAGE;
  }
  const wf = new WorkflowManager().install({ name: opts.name, steps: opts.steps, description: opts.description ?? `custom workflow: ${opts.steps.join(" → ")}` });
  out(`${t(ctx).success}Installed workflow:${t(ctx).reset} ${wf.name} → ${wf.steps.join(" → ")}`);
  return EXIT.OK;
}

export async function workflowRunCommand(
  ctx: AppContext,
  opts: { name: string; task: string; dir?: string; provider?: string; model?: string },
): Promise<number> {
  const wf = new WorkflowManager().findByName(opts.name);
  if (!wf) {
    err(`${t(ctx).error}Unknown workflow: ${opts.name}${t(ctx).reset}`);
    return EXIT.USAGE;
  }
  const { workspace, providerId, model } = await prepareRun(ctx, opts);
  out(`${t(ctx).bold}Running workflow:${t(ctx).reset} ${wf.name} (${wf.steps.join(" → ")})`);
  const result = await orchestrateTask({
    task: opts.task,
    workspace,
    registry: ctx.registry,
    providerId,
    model,
    onStep: (s) => out(`${t(ctx).accent}▶ ${s.title}${t(ctx).reset} ${t(ctx).dim}(${s.role})${t(ctx).reset}`),
  });
  out(`\n${t(ctx).success}Workflow complete${t(ctx).reset} — ${result.steps.length} roles in ${result.durationMs}ms.`);
  return EXIT.OK;
}

// ------------------------------------------------------------------ MCP
export async function mcpListCommand(ctx: AppContext): Promise<number> {
  const servers = new McpManager().list();
  if (servers.length === 0) {
    out(`${t(ctx).dim}No MCP servers. Add one with \`coder mcp add <name>\`.${t(ctx).reset}`);
    return EXIT.OK;
  }
  out(`${t(ctx).bold}MCP servers:${t(ctx).reset}`);
  for (const s of servers) {
    const state = !s.enabled ? "disabled" : s.connected ? "connected" : "disconnected";
    out(`  ${t(ctx).accent}${pad(s.name, 18)}${t(ctx).reset} ${pad(s.transport, 6)} ${t(ctx).dim}${pad(state, 12)}${t(ctx).reset} ${s.tools.length} tools`);
  }
  return EXIT.OK;
}

export async function mcpAddCommand(ctx: AppContext, opts: { name: string; command?: string; url?: string; transport?: string }): Promise<number> {
  if (!opts.command && !opts.url) {
    err(`${t(ctx).error}Provide --command (stdio) or --url (http/sse).${t(ctx).reset}`);
    return EXIT.USAGE;
  }
  const server = new McpManager().add({ name: opts.name, command: opts.command, url: opts.url, transport: opts.transport as never });
  out(`${t(ctx).success}Added MCP server:${t(ctx).reset} ${server.name} (${server.transport})`);
  return EXIT.OK;
}

export async function mcpRemoveCommand(ctx: AppContext, idOrName: string): Promise<number> {
  const mgr = new McpManager();
  const target = resolveMcp(mgr, idOrName);
  if (!target) return notFound(ctx, "MCP server", idOrName);
  mgr.remove(target.id);
  out(`${t(ctx).success}Removed MCP server:${t(ctx).reset} ${target.name}`);
  return EXIT.OK;
}

export async function mcpEnableCommand(ctx: AppContext, idOrName: string, enabled: boolean): Promise<number> {
  const mgr = new McpManager();
  const target = resolveMcp(mgr, idOrName);
  if (!target) return notFound(ctx, "MCP server", idOrName);
  mgr.setEnabled(target.id, enabled);
  out(`${t(ctx).success}${enabled ? "Enabled" : "Disabled"}:${t(ctx).reset} ${target.name}`);
  return EXIT.OK;
}

export async function mcpConnectCommand(ctx: AppContext, idOrName: string): Promise<number> {
  return mcpConn(ctx, idOrName, true);
}

export async function mcpDisconnectCommand(ctx: AppContext, idOrName: string): Promise<number> {
  return mcpConn(ctx, idOrName, false);
}

async function mcpConn(ctx: AppContext, idOrName: string, connect: boolean): Promise<number> {
  const mgr = new McpManager();
  const target = resolveMcp(mgr, idOrName);
  if (!target) return notFound(ctx, "MCP server", idOrName);
  const updated = connect ? mgr.connect(target.id) : mgr.disconnect(target.id);
  out(`${t(ctx).success}${connect ? "Connected" : "Disconnected"}:${t(ctx).reset} ${updated?.name ?? target.name}`);
  return EXIT.OK;
}

export async function mcpDiscoverCommand(ctx: AppContext, idOrName: string): Promise<number> {
  const mgr = new McpManager();
  const target = resolveMcp(mgr, idOrName);
  if (!target) return notFound(ctx, "MCP server", idOrName);
  const updated = await mgr.discover(target.id);
  out(`${t(ctx).success}Discovered ${updated?.tools.length ?? 0} tools${t(ctx).reset} for ${updated?.name ?? target.name}: ${(updated?.tools ?? []).join(", ") || "(none)"}`);
  return EXIT.OK;
}

function resolveMcp(mgr: McpManager, idOrName: string) {
  return mgr.get(idOrName) ?? mgr.list().find((s) => s.name === idOrName);
}

// ----------------------------------------------------------- extensions
export async function extensionListCommand(ctx: AppContext): Promise<number> {
  const exts = new ExtensionManager().list();
  if (exts.length === 0) {
    out(`${t(ctx).dim}No extensions. Install one with \`coder extension install <name>\`.${t(ctx).reset}`);
    return EXIT.OK;
  }
  out(`${t(ctx).bold}Extensions:${t(ctx).reset}`);
  for (const e of exts) {
    out(`  ${t(ctx).accent}${pad(e.manifest.name, 20)}${t(ctx).reset} ${pad(e.manifest.version, 10)} ${t(ctx).dim}${e.enabled ? "enabled" : "disabled"}${t(ctx).reset} ${e.manifest.description ?? ""}`);
  }
  return EXIT.OK;
}

export async function extensionInstallCommand(ctx: AppContext, opts: { name: string; version?: string; description?: string }): Promise<number> {
  const ext = new ExtensionManager().install(
    { name: opts.name, version: opts.version ?? "1.0.0", description: opts.description },
    opts.name,
  );
  out(`${t(ctx).success}Installed extension:${t(ctx).reset} ${ext.manifest.name}@${ext.manifest.version}`);
  return EXIT.OK;
}

export async function extensionRemoveCommand(ctx: AppContext, idOrName: string): Promise<number> {
  const mgr = new ExtensionManager();
  const target = mgr.get(idOrName) ?? mgr.list().find((e) => e.manifest.name === idOrName);
  if (!target) return notFound(ctx, "extension", idOrName);
  mgr.remove(target.id);
  out(`${t(ctx).success}Removed extension:${t(ctx).reset} ${target.manifest.name}`);
  return EXIT.OK;
}

export async function extensionUpdateCommand(ctx: AppContext, idOrName: string, opts: { version?: string; description?: string }): Promise<number> {
  const mgr = new ExtensionManager();
  const target = mgr.get(idOrName) ?? mgr.list().find((e) => e.manifest.name === idOrName);
  if (!target) return notFound(ctx, "extension", idOrName);
  const updated = mgr.update(target.id, { version: opts.version, description: opts.description });
  out(`${t(ctx).success}Updated extension:${t(ctx).reset} ${updated?.manifest.name}@${updated?.manifest.version}`);
  return EXIT.OK;
}

export async function extensionEnableCommand(ctx: AppContext, idOrName: string, enabled: boolean): Promise<number> {
  const mgr = new ExtensionManager();
  const target = mgr.get(idOrName) ?? mgr.list().find((e) => e.manifest.name === idOrName);
  if (!target) return notFound(ctx, "extension", idOrName);
  mgr.setEnabled(target.id, enabled);
  out(`${t(ctx).success}${enabled ? "Enabled" : "Disabled"}:${t(ctx).reset} ${target.manifest.name}`);
  return EXIT.OK;
}

// --------------------------------------------------------------- skills
export async function skillListCommand(ctx: AppContext): Promise<number> {
  const skills = new SkillManager().list();
  out(`${t(ctx).bold}Skills:${t(ctx).reset}`);
  for (const s of skills) {
    out(`  ${t(ctx).accent}${pad(s.name, 12)}${t(ctx).reset} ${pad(s.domain, 10)} ${t(ctx).dim}${s.builtin ? "builtin" : "custom"}${t(ctx).reset} ${s.description}`);
  }
  return EXIT.OK;
}

export async function skillShowCommand(ctx: AppContext, name: string): Promise<number> {
  const skill = new SkillManager().findByName(name);
  if (!skill) return notFound(ctx, "skill", name);
  out(new SkillManager().render(skill));
  return EXIT.OK;
}

export async function skillInstallCommand(ctx: AppContext, opts: { name: string; domain: string; description: string; systemPrompt: string; tools?: string[] }): Promise<number> {
  const skill = new SkillManager().install({ name: opts.name, domain: opts.domain, description: opts.description, systemPrompt: opts.systemPrompt, tools: opts.tools ?? [] });
  out(`${t(ctx).success}Installed skill:${t(ctx).reset} ${skill.name} (${skill.domain})`);
  return EXIT.OK;
}

export async function skillCreateCommand(ctx: AppContext, opts: { name: string; domain: string; description: string; systemPrompt: string; tools?: string[] }): Promise<number> {
  const skill = new SkillManager().create(opts);
  out(`${t(ctx).success}Created skill:${t(ctx).reset} ${skill.name}`);
  return EXIT.OK;
}

export async function skillUseCommand(
  ctx: AppContext,
  opts: { name: string; task: string; dir?: string; provider?: string; model?: string },
): Promise<number> {
  const skill = new SkillManager().findByName(opts.name);
  if (!skill) return notFound(ctx, "skill", opts.name);
  const { workspace, providerId, model } = await prepareRun(ctx, opts);
  out(`${t(ctx).bold}Skill:${t(ctx).reset} ${skill.name} — ${opts.task}`);
  const { planTask } = await import("../../orchestration/pipeline.js");
  const result = await planTask({ task: opts.task, workspace, registry: ctx.registry, providerId, model });
  out(`${t(ctx).muted}${skill.systemPrompt}${t(ctx).reset}\n\n${result.report}`);
  return EXIT.OK;
}

// ----------------------------------------------------------------- tasks
export async function taskListCommand(ctx: AppContext): Promise<number> {
  const queue = new TaskQueue();
  const tasks = queue.list();
  const stats = queue.stats();
  out(`${t(ctx).bold}Tasks:${t(ctx).reset} ${t(ctx).dim}queued ${stats.queued} · running ${stats.running} · succeeded ${stats.succeeded} · failed ${stats.failed} · cancelled ${stats.cancelled}${t(ctx).reset}`);
  for (const task of tasks.slice(0, 25)) {
    out(`  ${t(ctx).accent}${pad(task.id, 14)}${t(ctx).reset} ${pad(task.status, 10)} ${t(ctx).dim}${pad(task.kind, 12)}${t(ctx).reset} ${task.description.slice(0, 60)}`);
  }
  return EXIT.OK;
}

export async function taskRunCommand(ctx: AppContext, opts: { description: string; kind?: string }): Promise<number> {
  const task = new TaskQueue().enqueue(opts.kind ?? "background", opts.description);
  out(`${t(ctx).success}Queued task:${t(ctx).reset} ${task.id} (${task.kind}) — ${task.description}`);
  return EXIT.OK;
}

export async function taskStatusCommand(ctx: AppContext, id: string): Promise<number> {
  const task = new TaskQueue().get(id);
  if (!task) return notFound(ctx, "task", id);
  out(`${t(ctx).bold}${task.id}${t(ctx).reset} ${task.status} — ${task.description}`);
  if (task.result) out(`  result: ${task.result}`);
  if (task.error) out(`  ${t(ctx).error}error: ${task.error}${t(ctx).reset}`);
  return EXIT.OK;
}

export async function taskCancelCommand(ctx: AppContext, id: string): Promise<number> {
  const task = new TaskQueue().cancel(id);
  if (!task) return notFound(ctx, "task", id);
  out(`${t(ctx).success}Cancelled task:${t(ctx).reset} ${task.id}`);
  return EXIT.OK;
}

// --------------------------------------------------------------- helpers
function notFound(ctx: AppContext, kind: string, id: string): number {
  err(`${t(ctx).error}${kind} not found: ${id}${t(ctx).reset}`);
  return EXIT.USAGE;
}

function pad(value: string, width: number): string {
  const v = value.length > width ? `${value.slice(0, width - 1)}…` : value;
  return v.padEnd(width);
}
