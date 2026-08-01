/**
 * CODER — `coder scan`.
 *
 * Scans + indexes the repository and prints the Phase 3 statistics:
 * directories, source files, functions, classes, imports, tests.
 * When signed in, the index summary syncs to the backend.
 */

import { WorkspaceManager } from "../../workspace/workspace-manager.js";
import { renderTable } from "../../ui/components/primitives.js";
import { syncRepositoryToBackend } from "../../sync/workspace-sync.js";
import type { AppContext } from "../../core/application/application.js";

export interface ScanOptions {
  dir?: string;
  refresh?: boolean;
  json?: boolean;
  noSync?: boolean;
}

export async function scanCommand(ctx: AppContext, opts: ScanOptions = {}): Promise<number> {
  const { theme } = ctx;
  const root = opts.dir ?? process.cwd();
  if (!WorkspaceManager.isWorkspace(root)) {
    process.stderr.write(`${theme.error}Not a workspace directory: ${root}${theme.reset}\n`);
    return 1;
  }

  const manager = new WorkspaceManager({ root });
  const index = opts.refresh ? await manager.rescan() : await manager.ensureIndex();
  const stats = index.stats;

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
  } else {
    const rows = [
      ["Directories", String(stats.directories)],
      ["Source files", String(stats.sourceFiles)],
      ["Functions", String(stats.functions)],
      ["Classes", String(stats.classes)],
      ["Interfaces / types", String(stats.interfaces)],
      ["Imports", String(stats.imports)],
      ["Tests", String(stats.tests)],
      ["Lines of code", String(stats.linesOfCode)],
      ["Language", stats.language],
    ];
    process.stdout.write(
      `${theme.bold}Repository scan (${root})${theme.reset}\n` +
        `${renderTable(["METRIC", "COUNT"], rows)}\n` +
        `${theme.dim}Files indexed: ${index.files.length} · dependencies: ${index.dependencies.length} · scanned ${stats.scannedAt.slice(0, 19).replace("T", " ")}${theme.reset}\n`,
    );
  }

  if (!opts.noSync) {
    const { syncRepositoryToBackend } = await import("../../sync/workspace-sync.js");
    await syncRepositoryToBackend(ctx, index);
  }
  return 0;
}
