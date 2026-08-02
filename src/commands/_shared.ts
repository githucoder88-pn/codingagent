/**
 * CODER — shared command helpers (Phase 4+).
 *
 * Small utilities reused by the orchestration / cognitive / civilization
 * command groups: build a workspace manager at a root, resolve the active
 * provider+model, and format terminal rows consistently.
 */

import { WorkspaceManager } from "../workspace/workspace-manager.js";
import type { AppContext } from "../core/application/application.js";

export interface ResolvedRun {
  workspace: WorkspaceManager;
  providerId: string;
  model: string;
}

/** Build a workspace at `dir` (indexed) and resolve provider/model. */
export async function prepareRun(ctx: AppContext, opts: { dir?: string; provider?: string; model?: string }): Promise<ResolvedRun> {
  const root = opts.dir ?? process.cwd();
  const workspace = new WorkspaceManager({ root });
  await workspace.ensureIndex();
  const settings = ctx.settings();
  const providerId = opts.provider ?? settings.provider;
  const { provider, model } = ctx.registry.resolve(providerId, opts.model ?? settings.model);
  return { workspace, providerId: provider.id, model };
}

/** Pad/truncate a cell for aligned table output (non-TTY safe). */
export function pad(value: string, width: number): string {
  const v = value.length > width ? `${value.slice(0, width - 1)}…` : value;
  return v.padEnd(width);
}

/** Format a key/value summary line. */
export function kv(key: string, value: string | number): string {
  return `${key}: ${value}`;
}
