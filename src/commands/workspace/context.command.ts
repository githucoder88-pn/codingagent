/**
 * CODER — `coder context`.
 *
 * Builds and prints the repository context bundle: structure, stats,
 * git state, dependency summary, related files, documentation.
 */

import { WorkspaceManager } from "../../workspace/workspace-manager.js";
import type { AppContext } from "../../core/application/application.js";

export interface ContextOptions {
  dir?: string;
  json?: boolean;
}

export async function contextCommand(ctx: AppContext, opts: ContextOptions = {}): Promise<number> {
  const root = opts.dir ?? process.cwd();
  const manager = new WorkspaceManager({ root });
  await manager.ensureIndex();
  const engine = manager.context();
  const bundle = await engine.build({ includeGit: true });

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(`${engine.render(bundle)}\n`);
  return 0;
}
