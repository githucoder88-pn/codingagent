/**
 * CODER — scoped memory commands (Phase 5 / 7 / 9).
 *
 *   coder memory store <key> <value> [--scope ...] [--kind ...]
 *   coder memory recall <key> [--scope ...]
 *   coder memory search <query> [--scope ...]
 *
 * --scope accepts the canonical names (session|project|user|global) and the
 * memory-hierarchy aliases (immediate|working|long-term).
 */

import { EXIT } from "../../core/constants/index.js";
import type { AppContext } from "../../core/application/application.js";
import { ScopedMemory, canonicalScope, isKnownScope, type MemoryScope, type MemoryEntry } from "../../session/memory/scoped.js";

const t = (ctx: AppContext) => ctx.theme;
const out = (s: string) => process.stdout.write(`${s}\n`);
const err = (s: string) => process.stderr.write(`${s}\n`);
const cwd = () => process.cwd();

function scopeOrError(ctx: AppContext, input: string | undefined): MemoryScope | "all" | undefined {
  if (!input) return "all";
  if (!isKnownScope(input)) {
    err(`${t(ctx).error}Unknown scope "${input}". Try: session, project, user, global, immediate, working, long-term.${t(ctx).reset}`);
    return undefined;
  }
  return canonicalScope(input);
}

function printEntries(ctx: AppContext, entries: MemoryEntry[]): void {
  for (const e of entries) {
    out(`${t(ctx).accent}[${e.scope}]${t(ctx).reset} ${e.key} = ${e.value}${e.kind ? ` ${t(ctx).dim}(${e.kind})${t(ctx).reset}` : ""}`);
  }
}

export async function memoryStoreCommand(ctx: AppContext, opts: { key: string; value: string; scope?: string; kind?: string }): Promise<number> {
  const scope = canonicalScope(opts.scope ?? "user");
  const entry = new ScopedMemory().store(scope, opts.key, opts.value, { kind: opts.kind as never, repo: scope === "project" ? `repo:${cwd()}` : undefined });
  out(`${t(ctx).success}Stored${t(ctx).reset} [${scope}] ${entry.key} = ${entry.value.slice(0, 80)}`);
  return EXIT.OK;
}

export async function memoryRecallCommand(ctx: AppContext, opts: { key: string; scope?: string }): Promise<number> {
  const memory = new ScopedMemory();
  const scope = scopeOrError(ctx, opts.scope);
  if (scope === undefined) return EXIT.USAGE;
  const entries = scope === "all" ? memory.search(opts.key) : memory.recall(scope, opts.key);
  if (entries.length === 0) {
    out(`${t(ctx).dim}No memory found for "${opts.key}".${t(ctx).reset}`);
    return EXIT.OK;
  }
  printEntries(ctx, entries);
  return EXIT.OK;
}

export async function memorySearchCommand(ctx: AppContext, opts: { query: string; scope?: string }): Promise<number> {
  const scope = scopeOrError(ctx, opts.scope);
  if (scope === undefined) return EXIT.USAGE;
  const entries = new ScopedMemory().search(opts.query, scope === "all" ? undefined : scope);
  if (entries.length === 0) {
    out(`${t(ctx).dim}No memory matched "${opts.query}".${t(ctx).reset}`);
    return EXIT.OK;
  }
  out(`${t(ctx).bold}${entries.length} match(es):${t(ctx).reset}`);
  printEntries(ctx, entries);
  return EXIT.OK;
}
