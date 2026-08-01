/**
 * CODER — workspace types (Phase 3).
 *
 * Shared models for repository scanning, symbol indexing, dependency
 * analysis, search, embeddings and context bundles.
 */

export type SymbolKind = "function" | "class" | "interface" | "type" | "enum" | "struct" | "variable" | "import" | "export" | "method" | "property" | "module" | "test";

export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
  column: number;
  /** One-line signature (e.g. "function authenticate(token: string): User"). */
  signature?: string;
  /** Doc comment line(s) directly above the symbol, if any. */
  doc?: string;
}

export interface IndexedFile {
  path: string;
  hash: string;
  size: number;
  language: string;
  symbols: SymbolInfo[];
  imports: string[];
  exports: string[];
  isTest: boolean;
  lineCount: number;
}

export interface DependencyEdge {
  from: string;
  to: string;
  /** "relative" | "package" | "builtin" | "alias" */
  kind: string;
  line: number;
}

export interface RepoStats {
  root: string;
  language: string;
  directories: number;
  files: number;
  sourceFiles: number;
  functions: number;
  classes: number;
  interfaces: number;
  imports: number;
  tests: number;
  testFiles: number;
  linesOfCode: number;
  scannedAt: string;
}

export interface RepoIndex {
  root: string;
  stats: RepoStats;
  files: IndexedFile[];
  dependencies: DependencyEdge[];
  scannedAt: string;
}

export interface SearchResult {
  file: string;
  line: number;
  column: number;
  /** Matching line content (for content search). */
  snippet?: string;
  symbol?: SymbolInfo;
  score: number;
}

export interface RelatedFile {
  path: string;
  relation: "imports" | "imported-by" | "test" | "documentation";
}

export interface GitInfo {
  isRepo: boolean;
  branch?: string;
  lastCommit?: { hash: string; message: string; author: string; date: string };
  statusShort?: string;
  changedFiles: number;
}

export interface ContextBundle {
  root: string;
  structure: string;
  stats: RepoStats;
  git: GitInfo;
  dependencies: { edges: number; packages: string[]; topDependencies: Array<{ from: string; to: string; kind: string }> };
  related: RelatedFile[];
  docs: string[];
  /** Recent tool-edit history (previous edits, for continuity). */
  recentEdits: Array<{ tool: string; file: string; timestamp: string; ok: boolean }>;
  generatedAt: string;
}

export interface ToolResult {
  ok: boolean;
  /** Human-readable output. */
  output: string;
  /** Structured data (optional). */
  data?: unknown;
  error?: string;
}

export type PermissionLevel = "safe" | "balanced" | "full-auto";

export interface ExecutionRecord {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  /** Level required by the tool. */
  requiredLevel: PermissionLevel;
  result: ToolResult;
  /** Files touched by the tool (for undo). */
  touched: string[];
  /** Snapshot id when files were backed up before the call. */
  snapshotId?: string;
  timestamp: string;
  ok: boolean;
}
