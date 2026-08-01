/**
 * CODER — embedding store.
 *
 * Per-repository file embeddings persisted in ~/.coder/cache/workspace/
 * <repo>.embeddings.json. The indexer populates it; the search layer uses
 * it for semantic "related files" queries.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type IndexedFile, type RepoIndex } from "../types.js";
import { LocalHashEmbeddingProvider, cosineSimilarity, rankBySimilarity } from "./embeddings.js";

export interface StoredEmbedding {
  model: string;
  entries: Array<{ file: string; vector: number[] }>;
  updatedAt: string;
}

function storePath(root: string): string {
  const hash = createHash("sha256").update(resolve(root)).digest("hex").slice(0, 16);
  const dir = join(process.env.CODER_HOME ?? `${process.env.HOME}/.coder`, "cache", "workspace");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${hash}.embeddings.json`);
}

export class EmbeddingStore {
  private provider = new LocalHashEmbeddingProvider();

  /** (Re)compute embeddings for all indexed files and persist. */
  async indexFiles(index: RepoIndex): Promise<void> {
    const entries: Array<{ file: string; vector: number[] }> = [];
    for (const file of index.files) {
      // Embed the file's symbol surface + path — cheap and stable.
      const symbols = file.symbols.map((s) => `${s.kind} ${s.name} ${s.doc ?? ""}`).join("\n");
      const text = `${file.path}\n${symbols}\n${file.imports.join("\n")}`;
      entries.push({ file: file.path, vector: this.provider.embed(text) });
    }
    const stored: StoredEmbedding = {
      model: this.provider.model,
      entries,
      updatedAt: new Date().toISOString(),
    };
    try {
      writeFileSync(storePath(index.root), JSON.stringify(stored), { mode: 0o600 });
    } catch {
      /* best effort */
    }
  }

  load(root: string): StoredEmbedding | null {
    try {
      if (!existsSync(storePath(root))) return null;
      return JSON.parse(readFileSync(storePath(root), "utf8")) as StoredEmbedding;
    } catch {
      return null;
    }
  }

  /** Semantic file search: rank files by similarity to a query. */
  search(root: string, query: string, limit = 8): Array<{ file: string; score: number }> {
    const stored = this.load(root);
    if (!stored || stored.entries.length === 0) return [];
    const queryVector = this.provider.embed(query);
    return rankBySimilarity(queryVector, stored.entries.map((e) => ({ id: e.file, vector: e.vector })), limit).map((r) => ({ file: r.id, score: r.score }));
  }

  /** Most similar indexed files to a given file (related-code discovery). */
  relatedTo(root: string, file: string, limit = 5): Array<{ file: string; score: number }> {
    const stored = this.load(root);
    if (!stored) return [];
    const entry = stored.entries.find((e) => e.file === file);
    if (!entry) return [];
    return stored.entries
      .filter((e) => e.file !== file)
      .map((e) => ({ file: e.file, score: cosineSimilarity(entry.vector, e.vector) }))
      .filter((r) => r.score > 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  stats(root: string): { files: number; model: string } | null {
    const stored = this.load(root);
    return stored ? { files: stored.entries.length, model: stored.model } : null;
  }
}

export type { IndexedFile };
