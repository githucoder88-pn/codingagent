/**
 * CODER — workspace tools (scan, files, context).
 *
 * Repository-level operations exposed to the agent: re-scan the index and
 * list indexed files. These are the first calls an agent makes when
 * analyzing a repository.
 */

import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { type ToolDefinition, type ToolContext } from "./types.js";
import { type ToolResult } from "../workspace/types.js";

export const workspaceTools: ToolDefinition[] = [
  {
    id: "scan",
    name: "Scan the repository",
    description: "Scan and index the repository (files, symbols, dependencies, tests). Returns statistics.",
    level: "safe",
    mutating: false,
    params: [],
    async execute(_params, ctx: ToolContext) {
      const manager = new WorkspaceManager({ root: ctx.cwd });
      const index = await manager.rescan();
      const s = index.stats;
      return {
        ok: true,
        output: [
          `Language: ${s.language}`,
          `Directories: ${s.directories}`,
          `Source files: ${s.sourceFiles}`,
          `Functions: ${s.functions}`,
          `Classes: ${s.classes}`,
          `Imports: ${s.imports}`,
          `Tests: ${s.tests}`,
          `Lines of code: ${s.linesOfCode}`,
          `Dependency edges: ${index.dependencies.length}`,
        ].join("\n"),
      };
    },
  },
  {
    id: "files",
    name: "List repository files",
    description: "List the indexed source files (optionally filtered by pattern).",
    level: "safe",
    mutating: false,
    params: [{ name: "pattern", type: "string", description: "Path fragment filter" }],
    async execute(params, ctx: ToolContext) {
      const manager = new WorkspaceManager({ root: ctx.cwd });
      const index = await manager.ensureIndex();
      const needle = String(params.pattern ?? "").toLowerCase();
      const files = index.files
        .filter((f) => !needle || f.path.toLowerCase().includes(needle))
        .map((f) => `${f.path}${f.isTest ? " (test)" : ""}`);
      return { ok: true, output: files.slice(0, 300).join("\n") || "(no files)" };
    },
  },
  {
    id: "context",
    name: "Repository context",
    description: "Build the repository context bundle (structure, git, dependencies, docs).",
    level: "safe",
    mutating: false,
    params: [],
    async execute(_params, ctx: ToolContext) {
      const manager = new WorkspaceManager({ root: ctx.cwd });
      await manager.ensureIndex();
      const engine = manager.context();
      const bundle = await engine.build({ includeGit: true });
      return { ok: true, output: engine.render(bundle) };
    },
  },
];

export type { ToolResult };
