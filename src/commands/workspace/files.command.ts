/**
 * CODER — `coder files`.
 *
 * Lists the repository's files (source files by default) with language
 * and test markers. Supports --pattern and --json.
 */

import { WorkspaceManager } from "../../workspace/workspace-manager.js";
import { renderTable } from "../../ui/components/primitives.js";
import type { AppContext } from "../../core/application/application.js";

export interface FilesOptions {
  dir?: string;
  pattern?: string;
  all?: boolean;
  json?: boolean;
  limit?: number;
}

export async function filesCommand(ctx: AppContext, opts: FilesOptions = {}): Promise<number> {
  const { theme } = ctx;
  const root = opts.dir ?? process.cwd();
  const manager = new WorkspaceManager({ root });
  const index = await manager.ensureIndex();

  const needle = opts.pattern?.toLowerCase();
  const files = index.files.filter((f) => {
    if (needle && !f.path.toLowerCase().includes(needle)) return false;
    if (opts.all) return true;
    return true; // index.files are source files already
  });

  const limited = files.slice(0, opts.limit ?? 200);
  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify(limited.map((f) => ({ path: f.path, language: f.language, isTest: f.isTest, lines: f.lineCount, symbols: f.symbols.length })), null, 2)}\n`,
    );
    return 0;
  }

  const rows = limited.map((f) => [
    f.path,
    f.language,
    f.isTest ? "test" : "",
    String(f.lineCount),
    String(f.symbols.length),
  ]);
  process.stdout.write(
    `${renderTable(["FILE", "LANGUAGE", "KIND", "LINES", "SYMBOLS"], rows)}\n` +
      `${theme.dim}${files.length} file(s)${files.length > limited.length ? ` (showing ${limited.length})` : ""} · use --pattern to filter, --all for every file${theme.reset}\n`,
  );
  return 0;
}
