/**
 * CODER — `coder diff`, `coder undo`, `coder redo`, `coder checkpoints`,
 * `coder tools`.
 *
 * These commands operate on the shared execution ledger persisted in
 * ~/.coder/cache/workspace/execution.json so undo/redo and diffs survive
 * across CLI invocations within a workspace.
 */

import { ExecutionLedger } from "../../execution/ledger.js";
import { ExecutionScheduler } from "../../execution/scheduler.js";
import { computeDiff } from "../../tools/patch.js";
import type { AppContext } from "../../core/application/application.js";

export interface WorkspaceCommandOptions {
  dir?: string;
  json?: boolean;
}

function ledgerFor(root: string): ExecutionLedger {
  return new ExecutionLedger(root);
}

export async function diffCommand(ctx: AppContext, opts: WorkspaceCommandOptions & { staged?: boolean }): Promise<number> {
  const { theme } = ctx;
  const root = opts.dir ?? process.cwd();
  const ledger = ledgerFor(root);

  // Prefer git diff when inside a git repo.
  const { isGitRepo } = await import("../../execution/git-detect.js");
  if (await isGitRepo(root)) {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const exec = promisify(execFile);
    try {
      const args = opts.staged ? ["diff", "--cached"] : ["diff"];
      const { stdout } = await exec("git", args, { cwd: root });
      if (stdout.trim()) {
        process.stdout.write(stdout);
        return 0;
      }
    } catch {
      /* fall through to ledger */
    }
  }

  const records = ledger.recentMutating(10);
  if (records.length === 0) {
    process.stdout.write(`${theme.dim}No recorded workspace changes. Make edits via tools (or run \`coder chat --balanced\`).${theme.reset}\n`);
    return 0;
  }

  const sections: string[] = [];
  for (const record of records) {
    const file = record.touched[0];
    if (!file || record.snapshot === undefined) continue;
    const diff = computeDiff(file, record.snapshot, record.after ?? "");
    sections.push(`# ${record.timestamp.slice(0, 19).replace("T", " ")} — ${record.tool} ${file}\n${diff}`);
  }
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(records.map((r) => ({ tool: r.tool, touched: r.touched, timestamp: r.timestamp, ok: r.ok })), null, 2)}\n`);
    return 0;
  }
  process.stdout.write(sections.join("\n") || `${theme.dim}No diffs available.${theme.reset}\n`);
  return 0;
}

export async function undoCommand(ctx: AppContext, opts: WorkspaceCommandOptions): Promise<number> {
  const { theme } = ctx;
  const root = opts.dir ?? process.cwd();
  const ledger = ledgerFor(root);
  const undone = ledger.undo();
  if (!undone) {
    process.stdout.write(`${theme.dim}Nothing to undo.${theme.reset}\n`);
    return 0;
  }
  process.stdout.write(
    `${theme.success}Undid ${undone.record.tool}${undone.restored.length ? ` — restored ${undone.restored.join(", ")}` : ""}.${theme.reset}\n`,
  );
  return 0;
}

export async function redoCommand(ctx: AppContext, opts: WorkspaceCommandOptions): Promise<number> {
  const { theme } = ctx;
  const root = opts.dir ?? process.cwd();
  const ledger = ledgerFor(root);
  const redone = ledger.redo();
  if (!redone) {
    process.stdout.write(`${theme.dim}Nothing to redo.${theme.reset}\n`);
    return 0;
  }
  process.stdout.write(`${theme.success}Redid ${redone.record.tool}.${theme.reset}\n`);
  return 0;
}

export async function checkpointsCommand(ctx: AppContext, opts: WorkspaceCommandOptions): Promise<number> {
  const { theme } = ctx;
  const root = opts.dir ?? process.cwd();
  const { RollbackManager } = await import("../../execution/rollback.js");
  const { renderTable } = await import("../../ui/components/primitives.js");
  const list = RollbackManager.listCheckpoints(root);
  if (list.length === 0) {
    process.stdout.write(`${theme.dim}No checkpoints yet. Run \`coder checkpoints create\`.${theme.reset}\n`);
    return 0;
  }
  const rows = list.map((c) => [c.id, String(c.files), c.createdAt]);
  process.stdout.write(`${renderTable(["CHECKPOINT", "FILES", "CREATED"], rows)}\n`);
  return 0;
}

export async function checkpointCreateCommand(ctx: AppContext, opts: WorkspaceCommandOptions & { name?: string }): Promise<number> {
  const { theme } = ctx;
  const root = opts.dir ?? process.cwd();
  const { RollbackManager } = await import("../../execution/rollback.js");
  const { WorkspaceManager } = await import("../../workspace/workspace-manager.js");
  const manager = new WorkspaceManager({ root });
  const index = await manager.ensureIndex();
  const name = opts.name ?? "checkpoint";
  const { id, dir } = RollbackManager.createCheckpoint(root, name, index.files.map((f) => f.path));
  process.stdout.write(`${theme.success}Checkpoint created: ${id} (${dir}).${theme.reset}\n`);
  const { syncCheckpointToBackend } = await import("../../sync/workspace-sync.js");
  await syncCheckpointToBackend(ctx, root, id, index.files.length);
  return 0;
}

export async function checkpointRestoreCommand(ctx: AppContext, opts: WorkspaceCommandOptions & { id: string }): Promise<number> {
  const { theme } = ctx;
  const root = opts.dir ?? process.cwd();
  const { RollbackManager } = await import("../../execution/rollback.js");
  try {
    const restored = RollbackManager.restoreCheckpoint(root, opts.id);
    process.stdout.write(`${theme.success}Restored checkpoint ${opts.id} (${restored.length} files). Run \`coder scan --refresh\` to re-index.${theme.reset}\n`);
  } catch (err) {
    process.stdout.write(`${theme.error}${(err as Error).message}${theme.reset}\n`);
    return 1;
  }
  return 0;
}

export async function checkpointDeleteCommand(ctx: AppContext, opts: WorkspaceCommandOptions & { id: string }): Promise<number> {
  const { theme } = ctx;
  const root = opts.dir ?? process.cwd();
  const { RollbackManager } = await import("../../execution/rollback.js");
  const removed = RollbackManager.deleteCheckpoint(root, opts.id);
  process.stdout.write(
    removed ? `${theme.success}Deleted checkpoint ${opts.id}.${theme.reset}\n` : `${theme.dim}Checkpoint not found: ${opts.id}${theme.reset}\n`,
  );
  return removed ? 0 : 1;
}

export async function toolsCommand(ctx: AppContext): Promise<number> {
  const { theme } = ctx;
  const { listTools } = await import("../../tools/registry.js");
  const { renderTable } = await import("../../ui/components/primitives.js");
  const tools = listTools();
  const rows = tools.map((t) => [t.id, t.level, t.mutating ? "yes" : "no", t.description]);
  process.stdout.write(`${renderTable(["TOOL", "LEVEL", "MUTATES", "DESCRIPTION"], rows)}\n`);
  process.stdout.write(`${theme.dim}Levels: safe → read-only · balanced → writes/patches/git · full-auto → shell${theme.reset}\n`);
  return 0;
}
