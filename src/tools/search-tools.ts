/**
 * CODER — search tools (search_files, search_content, search_symbols,
 * search_dependencies, search_git_history). These operate on the current
 * workspace index, built on demand.
 */

import { type ToolDefinition, type ToolContext } from "./types.js";
import { type ToolResult } from "../workspace/types.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";

let workspacePromise: Promise<WorkspaceManager> | null = null;

async function getWorkspace(cwd: string): Promise<WorkspaceManager> {
  if (!workspacePromise) {
    workspacePromise = (async () => {
      const manager = new WorkspaceManager({ root: cwd });
      await manager.ensureIndex();
      return manager;
    })();
  }
  return workspacePromise;
}

function formatResults(results: Array<{ file: string; line: number; snippet?: string; symbol?: { name: string; kind: string } }>): string {
  return results
    .map((r) => `${r.file}:${r.line}${r.symbol ? ` [${r.symbol.kind} ${r.symbol.name}]` : ""}${r.snippet ? `  ${r.snippet.slice(0, 150)}` : ""}`)
    .join("\n");
}

export const searchTools: ToolDefinition[] = [
  {
    id: "search_files",
    name: "Search file names",
    description: "Find files whose path contains the query.",
    level: "safe",
    mutating: false,
    params: [{ name: "query", type: "string", required: true, description: "File-name pattern" }],
    async execute(params, ctx: ToolContext) {
      const ws = await getWorkspace(ctx.cwd);
      const files = ws.search().searchFiles(String(params.query ?? ""));
      return files.length ? { ok: true, output: files.join("\n") } : { ok: true, output: "(no matches)" };
    },
  },
  {
    id: "search_content",
    name: "Search file contents",
    description: "Grep-style content search across source files.",
    level: "safe",
    mutating: false,
    params: [
      { name: "query", type: "string", required: true, description: "Text to find" },
      { name: "caseSensitive", type: "boolean", description: "Case-sensitive match" },
    ],
    async execute(params, ctx: ToolContext) {
      const ws = await getWorkspace(ctx.cwd);
      const results = ws.search().searchContent(String(params.query ?? ""), { caseSensitive: Boolean(params.caseSensitive) });
      return results.length ? { ok: true, output: formatResults(results) } : { ok: true, output: "(no matches)" };
    },
  },
  {
    id: "search_symbols",
    name: "Search symbols",
    description: "Find functions, classes, interfaces and types by name.",
    level: "safe",
    mutating: false,
    params: [{ name: "query", type: "string", required: true, description: "Symbol name or fragment" }],
    async execute(params, ctx: ToolContext) {
      const ws = await getWorkspace(ctx.cwd);
      const results = ws.search().searchSymbols(String(params.query ?? ""));
      return results.length ? { ok: true, output: formatResults(results) } : { ok: true, output: "(no matches)" };
    },
  },
  {
    id: "search_dependencies",
    name: "Search dependencies",
    description: "Find files that import a module, or list package dependencies.",
    level: "safe",
    mutating: false,
    params: [{ name: "module", type: "string", description: "Module name or path" }],
    async execute(params, ctx: ToolContext) {
      const ws = await getWorkspace(ctx.cwd);
      const engine = ws.search();
      if (params.module) {
        const imports = engine.findImports(String(params.module));
        return imports.length
          ? { ok: true, output: imports.map((i) => `${i.file}:${i.line}`).join("\n") }
          : { ok: true, output: "(no importers)" };
      }
      const packages = engine.graph.packages();
      return { ok: true, output: packages.join("\n") || "(no package dependencies)" };
    },
  },
  {
    id: "search_git_history",
    name: "Search git history",
    description: "Search commit history for a term (git log -S).",
    level: "safe",
    mutating: false,
    params: [{ name: "query", type: "string", required: true, description: "Term to search in history" }],
    async execute(params, ctx: ToolContext) {
      const ws = await getWorkspace(ctx.cwd);
      const hits = await ws.search().searchGitHistory(String(params.query ?? ""), { maxResults: 20 });
      return hits.length
        ? { ok: true, output: hits.map((h) => `${h.hash} ${h.date.slice(0, 10)} ${h.author} — ${h.message}`).join("\n") }
        : { ok: true, output: "(no history matches)" };
    },
  },
  {
    id: "find_definition",
    name: "Find a symbol definition",
    description: "Locate the definition of a function/class/interface/variable.",
    level: "safe",
    mutating: false,
    params: [{ name: "name", type: "string", required: true, description: "Symbol name" }],
    async execute(params, ctx: ToolContext) {
      const ws = await getWorkspace(ctx.cwd);
      const results = ws.search().findDefinition(String(params.name ?? ""));
      return results.length ? { ok: true, output: formatResults(results) } : { ok: true, output: `(no definition found for ${params.name})` };
    },
  },
  {
    id: "find_references",
    name: "Find symbol references",
    description: "Find usages of a symbol across the repository.",
    level: "safe",
    mutating: false,
    params: [{ name: "name", type: "string", required: true, description: "Symbol name" }],
    async execute(params, ctx: ToolContext) {
      const ws = await getWorkspace(ctx.cwd);
      const results = ws.search().findReference(String(params.name ?? ""));
      return results.length ? { ok: true, output: formatResults(results) } : { ok: true, output: `(no references found for ${params.name})` };
    },
  },
  {
    id: "find_tests",
    name: "Find tests",
    description: "Find test files that exercise a file or symbol.",
    level: "safe",
    mutating: false,
    params: [{ name: "file", type: "string", description: "Source file path" }],
    async execute(params, ctx: ToolContext) {
      const ws = await getWorkspace(ctx.cwd);
      const tests = ws.search().findTests(String(params.file ?? ""));
      return tests.length ? { ok: true, output: tests.join("\n") } : { ok: true, output: "(no related tests)" };
    },
  },
  {
    id: "find_related",
    name: "Find related code",
    description: "Files that import, are imported by, or test the given file.",
    level: "safe",
    mutating: false,
    params: [{ name: "file", type: "string", required: true, description: "File path" }],
    async execute(params, ctx: ToolContext) {
      const ws = await getWorkspace(ctx.cwd);
      const related = ws.search().findRelatedCode(String(params.file ?? ""));
      return related.length
        ? { ok: true, output: related.map((r) => `[${r.relation}] ${r.path}`).join("\n") }
        : { ok: true, output: "(no related files)" };
    },
  },
];
