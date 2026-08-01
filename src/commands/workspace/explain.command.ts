/**
 * CODER — `coder explain <file>`.
 *
 * Local structural explanation of a file (symbols, imports/exports,
 * dependencies, related code, tests) plus an optional model-generated
 * prose explanation with `--ai`.
 */

import { WorkspaceManager } from "../../workspace/workspace-manager.js";
import { renderTable } from "../../ui/components/primitives.js";
import type { AppContext } from "../../core/application/application.js";

export interface ExplainOptions {
  file: string;
  dir?: string;
  symbol?: string;
  ai?: boolean;
  json?: boolean;
}

export async function explainCommand(ctx: AppContext, opts: ExplainOptions): Promise<number> {
  const { theme } = ctx;
  const root = opts.dir ?? process.cwd();
  const manager = new WorkspaceManager({ root });
  const index = await manager.ensureIndex();
  const engine = manager.search();

  const file = index.files.find((f) => f.path === opts.file || f.path.endsWith(`/${opts.file}`));
  if (!file) {
    process.stderr.write(`${theme.error}File not found in index: ${opts.file}. Run \`coder scan\` first.${theme.reset}\n`);
    return 1;
  }

  const related = engine.findRelatedCode(file.path);
  const tests = engine.findTests(file.path);

  const local: Record<string, unknown> = {
    file: file.path,
    language: file.language,
    lines: file.lineCount,
    isTest: file.isTest,
    symbols: file.symbols.slice(0, 100),
    imports: file.imports,
    exports: engine.findExports(file.path),
    related: related.slice(0, 20),
    tests: tests.slice(0, 20),
    dependencies: {
      importedBy: engine.graph.importedBy(file.path),
    },
  };

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(local, null, 2)}\n`);
    return 0;
  }

  const lines: string[] = [
    `${theme.bold}${file.path}${theme.reset}  ${theme.dim}${file.language} · ${file.lineCount} lines${file.isTest ? " · TEST" : ""}${theme.reset}`,
    "",
  ];
  if (file.symbols.length) {
    lines.push(`${theme.bold}Symbols (${file.symbols.length})${theme.reset}`);
    lines.push(
      renderTable(
        ["KIND", "NAME", "LINE", "SIGNATURE"],
        file.symbols.slice(0, 60).map((s) => [s.kind, s.name, String(s.line), s.signature?.slice(0, 80) ?? ""]),
      ),
    );
    lines.push("");
  }
  if (file.imports.length) {
    lines.push(`${theme.bold}Imports (${file.imports.length})${theme.reset}`);
    lines.push(file.imports.join("\n"));
    lines.push("");
  }
  if (related.length) {
    lines.push(`${theme.bold}Related${theme.reset}`);
    lines.push(related.map((r) => `  [${r.relation}] ${r.path}`).join("\n"));
    lines.push("");
  }
  if (tests.length) {
    lines.push(`${theme.bold}Tests${theme.reset}`);
    lines.push(tests.join("\n"));
    lines.push("");
  }
  process.stdout.write(`${lines.join("\n")}\n`);

  if (opts.ai) {
    const { explainWithModel } = await import("./explain-ai.js");
    const text = await explainWithModel(ctx, file.path, file.symbols.slice(0, 50), related, opts.dir);
    process.stdout.write(`${theme.bold}Model explanation${theme.reset}\n${text}\n`);
  } else {
    process.stdout.write(`${theme.dim}Add --ai for a model-generated explanation.${theme.reset}\n`);
  }
  return 0;
}
