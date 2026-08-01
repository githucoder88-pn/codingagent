/**
 * CODER — semantic search engine.
 *
 * Symbol and content search over a repository index, implementing the
 * Phase 3 operations: find_symbol, find_definition, find_reference,
 * find_imports, find_exports, find_related_code, find_tests, plus
 * content (grep-style) search.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DependencyGraph } from "../dependency/graph.js";
import { type RelatedFile, type RepoIndex, type SearchResult, type SymbolInfo } from "../types.js";

export interface SearchOptions {
  caseSensitive?: boolean;
  maxResults?: number;
}

export class SearchEngine {
  readonly graph: DependencyGraph;

  constructor(readonly index: RepoIndex) {
    this.graph = new DependencyGraph(index);
  }

  /** Find a symbol by exact name anywhere in the index. */
  findSymbol(name: string, opts: SearchOptions = {}): SearchResult[] {
    const results: SearchResult[] = [];
    for (const file of this.index.files) {
      for (const symbol of file.symbols) {
        if (symbol.name === name || (opts.caseSensitive ? symbol.name.includes(name) : symbol.name.toLowerCase().includes(name.toLowerCase()))) {
          results.push({
            file: symbol.file,
            line: symbol.line,
            column: symbol.column,
            symbol,
            score: symbol.name === name ? 1 : 0.5,
          });
        }
      }
    }
    return results.slice(0, opts.maxResults ?? 50);
  }

  /** Find the definition(s) of a symbol (function/class/interface/variable). */
  findDefinition(name: string): SearchResult[] {
    const defKinds = new Set(["function", "class", "interface", "type", "enum", "method", "variable", "struct"]);
    return this.findSymbol(name).filter((r) => r.symbol && defKinds.has(r.symbol.kind));
  }

  /** Find references (usages) of a symbol via content scan. */
  findReference(name: string, opts: SearchOptions = {}): SearchResult[] {
    const results: SearchResult[] = [];
    const needle = opts.caseSensitive ? name : name.toLowerCase();
    for (const file of this.index.files) {
      if (file.symbols.some((s) => s.name === name)) continue; // definitions handled by findDefinition
      try {
        const content = readFileSync(join(this.index.root, file.path), "utf8");
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i]!;
          const hay = opts.caseSensitive ? line : line.toLowerCase();
          if (hay.includes(needle)) {
            results.push({
              file: file.path,
              line: i + 1,
              column: line.indexOf(needle) + 1,
              snippet: line.trim().slice(0, 200),
              score: 0.8,
            });
          }
        }
      } catch {
        /* skip unreadable files */
      }
    }
    return results.slice(0, opts.maxResults ?? 50);
  }

  /** Files importing a module (relative path or package name). */
  findImports(moduleName: string): Array<{ file: string; line: number }> {
    // Match against the resolved target as well as extensionless variants
    // ("./auth" resolves to "src/auth.ts" in the graph) and basename
    // suffixes (a query of "./auth" should match "src/auth.ts").
    const candidates = [moduleName, ...this.extensionVariants(moduleName)];
    const normalized = moduleName.replace(/^\.\.?\//, "");
    return this.index.dependencies
      .filter((d) =>
        candidates.some((c) => d.to === c || d.to.startsWith(`${c}/`)) ||
        (normalized !== moduleName &&
          (d.to === normalized ||
            d.to.endsWith(`/${normalized}`) ||
            d.to.startsWith(`${normalized}.`) ||
            d.to.includes(`/${normalized}.`))),
      )
      .map((d) => ({ file: d.from, line: d.line }));
  }

  private extensionVariants(name: string): string[] {
    const exts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".cs", ".php"];
    const variants: string[] = [];
    for (const ext of exts) variants.push(`${name}${ext}`, `${name}/index${ext}`, `${name}/index.ts`);
    return [...new Set(variants)];
  }

  /** Export names declared by a file. */
  findExports(file: string): string[] {
    const indexed = this.index.files.find((f) => f.path === file);
    if (!indexed) return [];
    return indexed.exports.length
      ? indexed.exports
      : indexed.symbols
          .filter((s) => s.kind === "function" || s.kind === "class" || s.kind === "interface" || s.kind === "type" || s.kind === "enum")
          .map((s) => s.name);
  }

  /** Files related to `file`: imports, imported-by, tests, docs. */
  findRelatedCode(file: string): RelatedFile[] {
    const related: RelatedFile[] = [];
    for (const target of this.graph.importsOf(file)) related.push({ path: target, relation: "imports" });
    for (const source of this.graph.importedBy(file)) related.push({ path: source, relation: "imported-by" });
    for (const test of this.index.files.filter((f) => f.isTest)) {
      if (test.path === file) continue;
      // A test is related when it references the file or its symbols.
      const symbols = this.index.files.find((f) => f.path === file)?.symbols ?? [];
      const testContent = safeRead(join(this.index.root, test.path));
      if (symbols.some((s) => testContent.includes(s.name))) {
        related.push({ path: test.path, relation: "test" });
      }
    }
    for (const doc of this.index.files.filter((f) => f.path.toLowerCase().startsWith("readme") || f.path.endsWith(".md"))) {
      related.push({ path: doc.path, relation: "documentation" });
    }
    return related;
  }

  /** Tests that exercise `file` (by symbol reference). */
  findTests(file: string): string[] {
    return this.findRelatedCode(file).filter((r) => r.relation === "test").map((r) => r.path);
  }

  /** Content search (grep) across indexed source files. */
  searchContent(query: string, opts: SearchOptions = {}): SearchResult[] {
    const results: SearchResult[] = [];
    const needle = opts.caseSensitive ? query : query.toLowerCase();
    for (const file of this.index.files) {
      try {
        const content = readFileSync(join(this.index.root, file.path), "utf8");
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i]!;
          const hay = opts.caseSensitive ? line : line.toLowerCase();
          const idx = hay.indexOf(needle);
          if (idx !== -1) {
            results.push({
              file: file.path,
              line: i + 1,
              column: idx + 1,
              snippet: line.trim().slice(0, 200),
              score: 1,
            });
          }
        }
      } catch {
        /* skip */
      }
    }
    return results.slice(0, opts.maxResults ?? 50);
  }

  /** Search file names. */
  searchFiles(pattern: string): string[] {
    const needle = pattern.toLowerCase();
    return this.index.files
      .filter((f) => f.path.toLowerCase().includes(needle))
      .map((f) => f.path)
      .slice(0, 100);
  }

  /** Search symbol names + docs. */
  searchSymbols(query: string, opts: SearchOptions = {}): SearchResult[] {
    const needle = opts.caseSensitive ? query : query.toLowerCase();
    const results: SearchResult[] = [];
    for (const file of this.index.files) {
      for (const symbol of file.symbols) {
        const hay = opts.caseSensitive ? `${symbol.name} ${symbol.doc ?? ""}` : `${symbol.name} ${symbol.doc ?? ""}`.toLowerCase();
        if (hay.includes(needle)) {
          results.push({ file: symbol.file, line: symbol.line, column: symbol.column, symbol, score: 0.9 });
        }
      }
    }
    return results.slice(0, opts.maxResults ?? 50);
  }

  /** Search git history for a term (via git log -S). */
  async searchGitHistory(query: string, opts: { maxResults?: number } = {}): Promise<Array<{ hash: string; message: string; author: string; date: string }>> {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const exec = promisify(execFile);
    try {
      const { stdout } = await exec("git", ["log", `-S${query}`, "--oneline", "--pretty=format:%h%x1f%s%x1f%an%x1f%aI", "-n", String(opts.maxResults ?? 20)], { cwd: this.index.root, maxBuffer: 1024 * 1024 });
      return stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const [hash, message, author, date] = line.split("\u001f");
          return { hash: hash ?? "", message: message ?? "", author: author ?? "", date: date ?? "" };
        });
    } catch {
      return [];
    }
  }
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export type { SymbolInfo };
