/**
 * CODER — `coder search`.
 *
 * Content / symbol / file / dependency / git-history search over the
 * indexed workspace. Logs the query to the backend search history when
 * signed in (best-effort).
 */

import { WorkspaceManager } from "../../workspace/workspace-manager.js";
import { SearchEngine } from "../../workspace/search/search-engine.js";
import type { AppContext } from "../../core/application/application.js";

export interface SearchOptions {
  query: string;
  dir?: string;
  kind: "content" | "symbol" | "file" | "definition" | "references" | "dependencies" | "git";
  json?: boolean;
  caseSensitive?: boolean;
  limit?: number;
}

export async function searchCommand(ctx: AppContext, opts: SearchOptions): Promise<number> {
  const { theme } = ctx;
  const root = opts.dir ?? process.cwd();
  const manager = new WorkspaceManager({ root });
  await manager.ensureIndex();
  const engine: SearchEngine = manager.search();

  const limit = opts.limit ?? 50;
  let output: string;

  switch (opts.kind) {
    case "content": {
      const results = engine.searchContent(opts.query, { caseSensitive: opts.caseSensitive, maxResults: limit });
      output = renderResults(results.map((r) => `${r.file}:${r.line}:${r.column}  ${r.snippet ?? ""}`));
      if (opts.json) printJson(results);
      break;
    }
    case "symbol": {
      const results = engine.searchSymbols(opts.query, { maxResults: limit });
      output = renderResults(results.map((r) => `${r.file}:${r.line}  [${r.symbol?.kind ?? "?"} ${r.symbol?.name ?? "?"}]${r.symbol?.signature ? `  ${r.symbol.signature}` : ""}`));
      if (opts.json) printJson(results);
      break;
    }
    case "file": {
      const files = engine.searchFiles(opts.query);
      output = renderResults(files);
      if (opts.json) printJson(files);
      break;
    }
    case "definition": {
      const results = engine.findDefinition(opts.query);
      output = renderResults(results.map((r) => `${r.file}:${r.line}  [${r.symbol?.kind ?? "?"} ${r.symbol?.name ?? "?"}]`));
      if (opts.json) printJson(results);
      break;
    }
    case "references": {
      const results = engine.findReference(opts.query, { caseSensitive: opts.caseSensitive, maxResults: limit });
      output = renderResults(results.map((r) => `${r.file}:${r.line}  ${r.snippet ?? ""}`));
      if (opts.json) printJson(results);
      break;
    }
    case "dependencies": {
      const hits = engine.findImports(opts.query);
      output = renderResults(hits.map((h) => `${h.file}:${h.line}`));
      if (opts.json) printJson(hits);
      break;
    }
    case "git": {
      const hits = await engine.searchGitHistory(opts.query, { maxResults: limit });
      output = renderResults(hits.map((h) => `${h.hash} ${h.date.slice(0, 10)} ${h.author} — ${h.message}`));
      if (opts.json) printJson(hits);
      break;
    }
  }

  if (!opts.json) {
    process.stdout.write(`${output || `${theme.dim}No matches for "${opts.query}" (${opts.kind}).${theme.reset}`}\n`);
  }

  // Record the search in the backend history (best-effort, offline-tolerant).
  if (opts.kind === "content" || opts.kind === "symbol") {
    const { logSearchHistory } = await import("../../sync/workspace-sync.js");
    await logSearchHistory(ctx, opts.query, opts.kind, countLines(output)).catch(() => {});
  }
  return 0;
}

function countLines(output: string): number {
  return output ? output.split("\n").length : 0;
}

function renderResults(lines: string[]): string {
  return lines.slice(0, 100).join("\n");
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
