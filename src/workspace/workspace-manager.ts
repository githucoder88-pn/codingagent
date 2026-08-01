/**
 * CODER — workspace manager.
 *
 * Facade over scanning, indexing, dependency analysis, search, embeddings
 * and context. Resolves the workspace root (explicit --dir, or the current
 * directory), builds/loads the index cache, and exposes the engines.
 */

import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { RepositoryScanner, hashFileContent } from "./repository/scanner.js";
import { indexRepository, loadCachedIndex } from "./indexer/indexer.js";
import { SearchEngine } from "./search/search-engine.js";
import { EmbeddingStore } from "./embeddings/store.js";
import { ContextEngine } from "./context/engine.js";
import { type RepoIndex } from "./types.js";

export interface WorkspaceOptions {
  root?: string;
  ignore?: string[];
  /** Skip re-indexing when the cache exists (default false → always verify). */
  useCache?: boolean;
}

export class WorkspaceManager {
  readonly root: string;
  private index: RepoIndex | null = null;
  readonly embeddings: EmbeddingStore;

  constructor(opts: WorkspaceOptions = {}) {
    this.root = resolve(opts.root ?? process.cwd());
    this.embeddings = new EmbeddingStore();
    this.ignore = opts.ignore;
    this.useCache = opts.useCache ?? false;
  }

  private readonly ignore?: string[];
  private readonly useCache: boolean;

  static isWorkspace(root: string): boolean {
    return existsSync(root) && statSync(root).isDirectory();
  }

  /** Scan + index the repository. Rebuilds when files changed; otherwise
   *  reuses the persisted cache for speed. */
  async ensureIndex(force = false): Promise<RepoIndex> {
    if (this.index && !force) return this.index;
    if (!force && this.useCache) {
      const cached = await loadCachedIndex(this.root);
      if (cached) {
        this.index = cached;
        return cached;
      }
    }
    // Freshness check: reuse the cache only when the file list AND content
    // hashes match (cheap: hashing is fast, parsing is slow).
    const cached = await loadCachedIndex(this.root);
    if (cached && !force) {
      const scanner = new RepositoryScanner({ root: this.root, ignore: this.ignore });
      const scan = scanner.scan();
      const cacheHashes = new Map(cached.files.map((f) => [f.path, f.hash]));
      let same = scan.sourceFiles.length === cached.files.length;
      if (same) {
        for (const relPath of scan.sourceFiles) {
          try {
            const { readFileSync } = await import("node:fs");
            const content = readFileSync(join(this.root, relPath), "utf8");
            if (cacheHashes.get(relPath) !== hashFileContent(content)) {
              same = false;
              break;
            }
          } catch {
            same = false;
            break;
          }
        }
      }
      if (same) {
        this.index = cached;
        return cached;
      }
    }
    const fresh = await indexRepository({ root: this.root, ignore: this.ignore });
    await this.embeddings.indexFiles(fresh);
    this.index = fresh;
    return fresh;
  }

  /** Force a fresh scan + index (coder scan --refresh). */
  async rescan(): Promise<RepoIndex> {
    const fresh = await indexRepository({ root: this.root, ignore: this.ignore });
    await this.embeddings.indexFiles(fresh);
    this.index = fresh;
    return fresh;
  }

  get indexOrNull(): RepoIndex | null {
    return this.index;
  }

  search(): SearchEngine {
    if (!this.index) throw new Error("Workspace not indexed yet — call ensureIndex() first.");
    return new SearchEngine(this.index);
  }

  context(): ContextEngine {
    if (!this.index) throw new Error("Workspace not indexed yet — call ensureIndex() first.");
    return new ContextEngine(this.index);
  }

  async scanOnly(): Promise<ReturnType<RepositoryScanner["scan"]>> {
    return new RepositoryScanner({ root: this.root, ignore: this.ignore }).scan();
  }
}
