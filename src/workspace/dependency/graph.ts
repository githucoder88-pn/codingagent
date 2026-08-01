/**
 * CODER — dependency graph.
 *
 * File-level graph over the indexed imports: direct neighbors (imports /
 * imported-by), transitive closure, package dependencies, and cycles.
 */

import { type DependencyEdge, type IndexedFile, type RepoIndex } from "../types.js";

export class DependencyGraph {
  constructor(private readonly index: RepoIndex) {}

  /** Files directly imported by `file`. */
  importsOf(file: string): string[] {
    return this.index.dependencies.filter((d) => d.from === file && d.kind === "relative").map((d) => d.to);
  }

  /** Files that import `file` (directly). */
  importedBy(file: string): string[] {
    return this.index.dependencies.filter((d) => d.to === file && d.kind === "relative").map((d) => d.from);
  }

  /** Transitive closure of files reachable from `file` (imports). */
  transitiveImports(file: string, maxDepth = 10): string[] {
    const seen = new Set<string>();
    const queue = [file];
    let depth = 0;
    while (queue.length && depth < maxDepth) {
      const current = queue.shift()!;
      for (const next of this.importsOf(current)) {
        if (!seen.has(next) && next !== file) {
          seen.add(next);
          queue.push(next);
        }
      }
      depth += 1;
    }
    return [...seen];
  }

  /** External (package) dependencies of the repository. */
  packages(): string[] {
    const seen = new Set<string>();
    for (const d of this.index.dependencies) {
      if (d.kind === "package") seen.add(d.to);
    }
    return [...seen].sort();
  }

  /** Simple cycle detection over relative import edges. */
  cycles(): string[][] {
    const edges = this.index.dependencies.filter((d) => d.kind === "relative");
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      const list = adjacency.get(edge.from) ?? [];
      list.push(edge.to);
      adjacency.set(edge.from, list);
    }
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const stack: string[] = [];

    const dfs = (node: string): void => {
      if (visited.has(node)) return;
      visited.add(node);
      stack.push(node);
      for (const next of adjacency.get(node) ?? []) {
        if (stack.includes(next)) {
          const cycle = [...stack.slice(stack.indexOf(next)), next];
          cycles.push(cycle);
        } else {
          dfs(next);
        }
      }
      stack.pop();
    };

    for (const node of adjacency.keys()) dfs(node);
    return cycles;
  }

  /** Top dependencies by fan-in (most imported files). */
  topDependencies(limit = 10): Array<{ file: string; importedBy: number }> {
    const counts = new Map<string, number>();
    for (const d of this.index.dependencies) {
      if (d.kind === "relative") counts.set(d.to, (counts.get(d.to) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([file, importedBy]) => ({ file, importedBy }))
      .sort((a, b) => b.importedBy - a.importedBy)
      .slice(0, limit);
  }

  /** Files that form the "core" (imported by many). */
  coreFiles(limit = 5): string[] {
    return this.topDependencies(limit).map((d) => d.file);
  }

  fileList(): IndexedFile[] {
    return this.index.files;
  }
}
