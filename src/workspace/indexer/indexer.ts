/**
 * CODER — indexing engine.
 *
 * Parses every source file in the scanned repository into symbols,
 * imports/exports, test markers and file hashes, and builds the
 * dependency graph. Results are cached per repository (~/.coder/cache/
 * workspace/<hash>.json) and reused when nothing changed.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { RepositoryScanner, hashFileContent, languageForFile, isTestFile } from "../repository/scanner.js";
import { parseFile } from "../parser/index.js";
import { type DependencyEdge, type IndexedFile, type RepoIndex, type RepoStats, type SymbolInfo } from "../types.js";

export interface IndexOptions {
  root: string;
  ignore?: string[];
  /** Reuse the cache when files are unchanged (default true). */
  useCache?: boolean;
}

function repoCacheKey(root: string): string {
  return createHash("sha256").update(resolve(root)).digest("hex").slice(0, 16);
}

export function workspaceCacheDir(): string {
  return join(process.env.CODER_HOME ?? `${process.env.HOME}/.coder`, "cache", "workspace");
}

export async function indexRepository(opts: IndexOptions): Promise<RepoIndex> {
  const scanner = new RepositoryScanner({ root: opts.root, ignore: opts.ignore });
  const scan = scanner.scan();

  const cacheDir = workspaceCacheDir();
  const { mkdirSync } = await import("node:fs");
  mkdirSync(cacheDir, { recursive: true });
  const cacheFile = join(cacheDir, `${repoCacheKey(opts.root)}.json`);

  const files: IndexedFile[] = [];
  const dependencies: DependencyEdge[] = [];
  const symbols: SymbolInfo[] = [];
  let functions = 0;
  let classes = 0;
  let interfaces = 0;
  let imports = 0;

  for (const relPath of scan.sourceFiles) {
    const full = join(resolve(opts.root), relPath);
    let content = "";
    try {
      content = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const hash = hashFileContent(content);
    const parsed = await parseFile(content, relPath);
    const file: IndexedFile = {
      path: relPath,
      hash,
      size: Buffer.byteLength(content, "utf8"),
      language: languageForFile(relPath),
      symbols: parsed.symbols,
      imports: parsed.imports,
      exports: parsed.exports,
      isTest: isTestFile(relPath),
      lineCount: content.split(/\r?\n/).length,
    };
    files.push(file);
    symbols.push(...parsed.symbols);

    for (const s of parsed.symbols) {
      if (s.kind === "function" || s.kind === "method") functions += 1;
      else if (s.kind === "class") classes += 1;
      else if (s.kind === "interface" || s.kind === "type") interfaces += 1;
      else if (s.kind === "import") imports += 1;
    }
    imports += parsed.imports.length;

    for (const spec of parsed.imports) {
      dependencies.push(resolveDependencyEdge(relPath, spec, parsed.imports.indexOf(spec) + 1));
    }
  }

  // Resolve relative imports to concrete files.
  const resolvedDeps = dependencies.map((edge) => ({
    ...edge,
    to: resolveImportTarget(edge.to, edge.from, files),
  }));

  const stats: RepoStats = {
    ...scan.stats,
    functions,
    classes,
    interfaces,
    imports,
    tests: scan.testFiles.length + files.filter((f) => f.isTest).length,
    testFiles: scan.testFiles.length,
    scannedAt: new Date().toISOString(),
  };

  const index: RepoIndex = {
    root: resolve(opts.root),
    stats,
    files,
    dependencies: resolvedDeps,
    scannedAt: new Date().toISOString(),
  };

  // Persist the cache (async, best-effort).
  const { writeFileSync } = await import("node:fs");
  try {
    writeFileSync(cacheFile, JSON.stringify(index), { mode: 0o600 });
  } catch {
    /* cache is best-effort */
  }
  return index;
}

/** Load a cached index if it exists and is fresh enough (no staleness check — callers decide). */
export async function loadCachedIndex(root: string): Promise<RepoIndex | null> {
  const cacheFile = join(workspaceCacheDir(), `${repoCacheKey(root)}.json`);
  try {
    const { readFileSync } = await import("node:fs");
    const parsed = JSON.parse(readFileSync(cacheFile, "utf8")) as RepoIndex;
    if (parsed.root !== resolve(root)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function resolveDependencyEdge(from: string, spec: string, line: number): DependencyEdge {
  let kind = "package";
  if (spec.startsWith(".") || spec.startsWith("/")) kind = "relative";
  else if (spec.startsWith("node:") || spec === "os" || spec === "fs" || spec === "path" || spec === "crypto" || spec === "http" || spec === "child_process") kind = "builtin";
  return { from, to: spec, kind, line };
}

function resolveImportTarget(spec: string, from: string, files: IndexedFile[]): string {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return spec;
  const fromDir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  // Normalize "./auth" → "auth" so it joins cleanly with the importing dir.
  let clean = spec;
  while (clean.startsWith("./")) clean = clean.slice(2);
  const candidates = [
    clean,
    `${clean}.ts`,
    `${clean}.tsx`,
    `${clean}.js`,
    `${clean}.jsx`,
    `${clean}.mjs`,
    `${clean}/index.ts`,
    `${clean}/index.tsx`,
    `${clean}/index.js`,
    `${clean}.py`,
    `${clean}.go`,
    `${clean}.rs`,
    `${clean}.java`,
    `${clean}.c`,
    `${clean}.cpp`,
    `${clean}.cs`,
    `${clean}.php`,
  ];
  for (const candidate of candidates) {
    const normalized = candidate.startsWith("/")
      ? candidate.slice(1)
      : fromDir
        ? `${fromDir}/${candidate}`
        : candidate;
    if (files.some((f) => f.path === normalized)) return normalized;
  }
  return spec;
}

/** Re-export helper used by tools. */
export function fileRelativeTo(root: string, file: string): string {
  return relative(resolve(root), resolve(file)).split("\\").join("/");
}
