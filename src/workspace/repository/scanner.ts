/**
 * CODER — workspace repository scanner.
 *
 * Walks a repository (respecting .gitignore), classifies files by language
 * and role (source / test / documentation / config), detects the primary
 * language, and computes scan statistics.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { type RepoStats, type IndexedFile } from "../types.js";

// ------------------------------------------------------------ languages

const EXT_LANGUAGE: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".php": "php",
};

const LANGUAGE_BY_FILE: Record<string, string> = {
  "package.json": "json",
  "tsconfig.json": "json",
  "pyproject.toml": "toml",
  "Cargo.toml": "toml",
  "go.mod": "go",
  "pom.xml": "xml",
  "build.gradle": "groovy",
  "composer.json": "json",
  "requirements.txt": "python",
  "Makefile": "make",
};

/** Languages CODER can index symbols for (Phase 3 scope). */
export const SUPPORTED_LANGUAGES = [
  "javascript", "typescript", "python", "go", "rust", "java", "c", "cpp", "csharp", "php",
] as const;

export function languageForFile(file: string): string {
  const base = basename(file).toLowerCase();
  // Multi-char extensions first (.tsx before .ts, .cpp before .c).
  for (const ext of [".tsx", ".mts", ".cts", ".jsx", ".mjs", ".cjs", ".cpp", ".cxx", ".hpp"]) {
    if (base.endsWith(ext) && EXT_LANGUAGE[ext]) return EXT_LANGUAGE[ext]!;
  }
  const dot = base.lastIndexOf(".");
  if (dot !== -1) {
    const ext = base.slice(dot);
    const mapped = EXT_LANGUAGE[ext];
    if (mapped) return mapped;
  }
  return LANGUAGE_BY_FILE[base] ?? "text";
}

export function isSourceFile(file: string): boolean {
  const lang = languageForFile(file);
  return lang !== "text" && lang !== "json" && lang !== "toml" && lang !== "xml" && lang !== "make";
}

export function isTestFile(file: string): boolean {
  const base = basename(file).toLowerCase();
  return (
    base.startsWith("test_") ||
    base.includes(".test.") ||
    base.includes("_test.") ||
    base.includes(".spec.") ||
    base.includes("_spec.") ||
    (languageForFile(file) === "go" && base.endsWith("_test.go"))
  );
}

// ---------------------------------------------------------- gitignore

/**
 * Minimal .gitignore matcher (glob patterns with **, *, ?, negation).
 * Good enough for scanning; not a full git semantics implementation.
 */
export class GitignoreMatcher {
  private rules: Array<{ pattern: string; negate: boolean; dirOnly: boolean; base: string }> = [];

  constructor(root: string) {
    this.load(root, root);
  }

  private load(root: string, dir: string): void {
    const file = join(dir, ".gitignore");
    try {
      const content = readFileSync(file, "utf8");
      for (const rawLine of content.split(/\r?\n/)) {
        let line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const negate = line.startsWith("!");
        if (negate) line = line.slice(1).trim();
        const dirOnly = line.endsWith("/");
        if (dirOnly) line = line.slice(0, -1);
        this.rules.push({
          pattern: line,
          negate,
          dirOnly,
          base: dirname(file),
        });
      }
    } catch {
      /* no .gitignore in this dir */
    }
    // Nested .gitignore files (one level of recursion into subdirs).
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === ".git" || entry === "node_modules") continue;
      const full = join(dir, entry);
      try {
        if (statSync(full).isDirectory()) this.load(root, full);
      } catch {
        /* skip */
      }
    }
  }

  /** Is `relPath` (relative to root, posix) ignored? */
  isIgnored(relPath: string, isDir: boolean): boolean {
    let ignored = false;
    for (const rule of this.rules) {
      const relFromBase = relative(rule.base, join(this.root, relPath)).split("\\").join("/");
      if (relFromBase.startsWith("..")) continue;
      if (rule.dirOnly && !isDir) continue;
      if (matchesPattern(relFromBase, rule.pattern) || matchesPattern(basename(relFromBase), rule.pattern)) {
        ignored = !rule.negate;
      }
    }
    return ignored;
  }

  private root = "";
}

function matchesPattern(path: string, pattern: string): boolean {
  if (pattern.includes("/")) {
    return globMatch(path, pattern);
  }
  // Bare pattern matches the basename at any depth.
  return globMatch(path, `**/${pattern}`) || globMatch(basename(path), pattern);
}

function globMatch(path: string, pattern: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(path);
}

export function globToRegex(pattern: string): RegExp {
  let out = "^";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // ** matches across directories
        out += ".*";
        i += 2;
        if (pattern[i] === "/") i += 1;
        continue;
      }
      out += "[^/]*";
    } else if (c === "?") {
      out += "[^/]";
    } else if (c === "[") {
      const close = pattern.indexOf("]", i + 1);
      if (close === -1) {
        out += "\\[";
      } else {
        out += pattern.slice(i, close + 1);
        i = close;
      }
    } else {
      out += c.replace(/[.+^${}()|\\]/g, "\\$&");
    }
    i += 1;
  }
  out += "$";
  return new RegExp(out);
}

// ------------------------------------------------------------- scanner

export interface ScanOptions {
  root: string;
  /** Extra ignore patterns (e.g. dist, node_modules). */
  ignore?: string[];
  maxFiles?: number;
}

export interface ScanOutput {
  stats: RepoStats;
  files: string[]; // relative posix paths of all files
  sourceFiles: string[]; // files that can be indexed
  testFiles: string[];
  docFiles: string[];
  directories: number;
}

const DEFAULT_IGNORE = [
  ".git", "node_modules", "dist", "build", "out", "target", "coverage", ".next", ".nuxt",
  ".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache", "vendor", ".cache",
];

export class RepositoryScanner {
  constructor(private readonly options: ScanOptions) {}

  scan(): ScanOutput {
    const root = resolve(this.options.root);
    const matcher = new GitignoreMatcher(root);
    const ignore = new Set([...DEFAULT_IGNORE, ...(this.options.ignore ?? [])]);
    const files: string[] = [];
    const sourceFiles: string[] = [];
    const testFiles: string[] = [];
    const docFiles: string[] = [];
    let directories = 0;
    let linesOfCode = 0;
    const maxFiles = this.options.maxFiles ?? 50_000;

    const walk = (dir: string): void => {
      let entries: string[] = [];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      directories += 1;
      for (const entry of entries) {
        if (files.length >= maxFiles) return;
        const full = join(dir, entry);
        const rel = relative(root, full).split("\\").join("/");
        let isDir = false;
        try {
          isDir = statSync(full).isDirectory();
        } catch {
          continue;
        }
        if (isDir) {
          if (ignore.has(entry) || ignore.has(rel) || matcher.isIgnored(rel, true)) continue;
          walk(full);
          continue;
        }
        if (ignore.has(entry) || ignore.has(rel) || matcher.isIgnored(rel, false)) continue;
        files.push(rel);
        const lang = languageForFile(entry);
        if (isTestFile(rel)) testFiles.push(rel);
        if (isSourceFile(rel)) {
          sourceFiles.push(rel);
          try {
            linesOfCode += readFileSync(full, "utf8").split(/\r?\n/).length;
          } catch {
            /* skip */
          }
        }
        if (lang === "markdown" || entry === "README.md" || entry === "README") docFiles.push(rel);
      }
    };

    walk(root);

    const stats: RepoStats = {
      root,
      language: detectPrimaryLanguage(sourceFiles),
      directories,
      files: files.length,
      sourceFiles: sourceFiles.length,
      functions: 0,
      classes: 0,
      interfaces: 0,
      imports: 0,
      tests: testFiles.length,
      testFiles: testFiles.length,
      linesOfCode,
      scannedAt: new Date().toISOString(),
    };

    return { stats, files, sourceFiles, testFiles, docFiles, directories };
  }
}

/** Count lines + compute a stable content hash for a file. */
export function hashFileContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function detectPrimaryLanguage(sourceFiles: string[]): string {
  const counts = new Map<string, number>();
  for (const file of sourceFiles) {
    const lang = languageForFile(file);
    if (isSourceFile(file)) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  let best = "unknown";
  let bestCount = 0;
  for (const [lang, count] of counts) {
    if (count > bestCount) {
      best = lang;
      bestCount = count;
    }
  }
  return best;
}

export { join as pathJoin };
