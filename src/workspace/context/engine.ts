/**
 * CODER — context engine.
 *
 * Builds a compact context bundle from the repository index: structure,
 * statistics, dependency graph summary, git state, related files,
 * documentation and (optionally) recent execution history. This is the
 * payload fed to the model in agent mode and shown by `coder context`.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ContextBundle, type GitInfo, type RelatedFile, type RepoIndex } from "../types.js";
import { DependencyGraph } from "../dependency/graph.js";
import { EmbeddingStore } from "../embeddings/store.js";

const exec = promisify(execFile);

export interface ContextOptions {
  /** Include README/documentation snippets. */
  includeDocs?: boolean;
  /** Include git state (slower). */
  includeGit?: boolean;
  maxDepth?: number;
}

function gitInfo(root: string): Promise<GitInfo> {
  return (async () => {
    let isRepo = false;
    const branch = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root })
      .then((r) => {
        isRepo = true;
        return r.stdout.trim();
      })
      .catch(() => "");
    if (!isRepo) return { isRepo: false, changedFiles: 0 };
    const [last, status] = await Promise.all([
      exec("git", ["log", "-1", "--pretty=format:%h%x1f%s%x1f%an%x1f%aI"], { cwd: root }).then((r) => r.stdout).catch(() => ""),
      exec("git", ["status", "--short"], { cwd: root }).then((r) => r.stdout).catch(() => ""),
    ]);
    const [hash, message, author, date] = last.split("\u001f");
    return {
      isRepo: true,
      branch: branch || undefined,
      lastCommit: hash ? { hash, message: message ?? "", author: author ?? "", date: date ?? "" } : undefined,
      statusShort: status.slice(0, 400),
      changedFiles: status ? status.split(/\r?\n/).filter(Boolean).length : 0,
    };
  })();
}

function structureTree(index: RepoIndex, maxDepth = 2): string {
  const depth = (rel: string): number => rel.split("/").length - 1;
  const visible = index.files.filter((f) => depth(f.path) < maxDepth);
  const dirs = new Set<string>();
  for (const file of index.files) {
    const parts = file.path.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }
  const lines: string[] = [];
  for (const dir of [...dirs].sort()) {
    if (dir.split("/").length <= maxDepth) lines.push(`📁 ${dir}/`);
  }
  for (const file of visible.sort()) {
    const isTest = file.isTest ? " (test)" : "";
    lines.push(`   ${file.path}${isTest}`);
  }
  return lines.slice(0, 120).join("\n");
}

export class ContextEngine {
  private readonly embeddings = new EmbeddingStore();

  constructor(private readonly index: RepoIndex) {}

  async build(opts: ContextOptions = {}): Promise<ContextBundle> {
    const graph = new DependencyGraph(this.index);
    const git = opts.includeGit === false ? { isRepo: false, changedFiles: 0 } : await gitInfo(this.index.root);

    const docs: string[] = [];
    if (opts.includeDocs !== false) {
      // Discovery is independent of the symbol index (READMEs are not
      // source files): check the root and one level of directories.
      const candidates: string[] = [];
      try {
        const { readdirSync, statSync } = await import("node:fs");
        for (const entry of readdirSync(this.index.root, { withFileTypes: true })) {
          const base = entry.name.toLowerCase();
          if (entry.isFile() && (base === "readme.md" || base === "readme" || base.endsWith(".md"))) {
            candidates.push(entry.name);
          } else if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
            const sub = join(this.index.root, entry.name);
            if (statSync(sub).isDirectory()) {
              for (const subEntry of readdirSync(sub, { withFileTypes: true })) {
                const subBase = subEntry.name.toLowerCase();
                if (subEntry.isFile() && (subBase === "readme.md" || subBase === "readme" || subBase.endsWith(".md"))) {
                  candidates.push(`${entry.name}/${subEntry.name}`);
                }
              }
            }
          }
        }
      } catch {
        /* skip */
      }
      for (const file of candidates.slice(0, 3)) {
        try {
          const content = readFileSync(join(this.index.root, file), "utf8");
          docs.push(`--- ${file} ---\n${content.slice(0, 1500)}`);
        } catch {
          /* skip */
        }
      }
    }

    // Related files for the most central modules + semantic neighbors.
    const related: RelatedFile[] = [];
    const top = graph.topDependencies(3);
    for (const entry of top) {
      related.push({ path: entry.file, relation: "imports" });
    }
    for (const file of this.index.files.slice(0, 5)) {
      const semantic = this.embeddings.relatedTo(this.index.root, file.path, 2);
      for (const hit of semantic) {
        if (!related.some((r) => r.path === hit.file)) related.push({ path: hit.file, relation: "imports" });
      }
    }

    return {
      root: this.index.root,
      structure: structureTree(this.index, opts.maxDepth ?? 2),
      stats: this.index.stats,
      git,
      dependencies: {
        edges: this.index.dependencies.length,
        packages: graph.packages().slice(0, 30),
        topDependencies: this.index.dependencies.filter((d) => d.kind === "relative").slice(0, 20),
      },
      related: related.slice(0, 15),
      docs: docs.slice(0, 3),
      generatedAt: new Date().toISOString(),
    };
  }

  /** Compact text rendering of the bundle (for the model prompt). */
  render(bundle: ContextBundle): string {
    const lines = [
      `# Repository context (${bundle.root})`,
      `Language: ${bundle.stats.language} · Files: ${bundle.stats.sourceFiles} source / ${bundle.stats.files} total · LOC: ${bundle.stats.linesOfCode}`,
      `Symbols: ${bundle.stats.functions} functions · ${bundle.stats.classes} classes · ${bundle.stats.interfaces} interfaces · ${bundle.stats.imports} imports · ${bundle.stats.tests} tests`,
      ``,
      `## Structure`,
      bundle.structure,
      ``,
      `## Git`,
      bundle.git.isRepo
        ? `branch: ${bundle.git.branch ?? "?"} · changed files: ${bundle.git.changedFiles}\nlast commit: ${bundle.git.lastCommit?.hash ?? "—"} ${bundle.git.lastCommit?.message ?? ""}`
        : "not a git repository",
      ``,
      `## Dependencies`,
      `edges: ${bundle.dependencies.edges} · packages: ${bundle.dependencies.packages.join(", ") || "—"}`,
      ``,
      `## Related files`,
      bundle.related.map((r) => `  [${r.relation}] ${r.path}`).join("\n"),
      ``,
      `## Documentation`,
      bundle.docs.join("\n\n") || "—",
    ];
    return lines.join("\n");
  }
}

export { gitInfo, structureTree };
