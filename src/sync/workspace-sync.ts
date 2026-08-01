/**
 * CODER — workspace → backend sync (Phase 3).
 *
 * Best-effort upload of repository indexes, search history, checkpoints
 * and patches to the control plane when signed in. Never throws —
 * offline usage keeps everything local.
 */

import { loadSession } from "../account/session-store.js";
import { ApiClient } from "../account/api-client.js";
import { loadCachedIndex } from "../workspace/indexer/indexer.js";
import type { AppContext } from "../core/application/application.js";
import type { RepoIndex } from "../workspace/types.js";

async function client(): Promise<ApiClient | null> {
  return loadSession() ? ApiClient.fromSession() : null;
}

/** Upload the repository index summary + files + embeddings. */
export async function syncRepositoryToBackend(ctx: AppContext, index: RepoIndex): Promise<boolean> {
  const api = await client();
  if (!api) return false;
  try {
    const name = index.root.split(/[\\/]/).filter(Boolean).pop() ?? index.root;
    const repo = await api.post<{ id: string }>("/workspace/repositories", {
      path: index.root,
      name,
      language: index.stats.language,
      fileCount: index.files.length,
      symbolCount: index.stats.functions + index.stats.classes + index.stats.interfaces,
      lineCount: index.stats.linesOfCode,
      indexedAt: index.scannedAt,
    });
    const repoId = repo.body.id;
    await api.post(`/workspace/repositories/${repoId}/files`, {
      files: index.files.map((f) => ({ path: f.path, hash: f.hash, size: f.size, language: f.language })),
    });
    // Embeddings (local vectors) — uploaded as JSON vectors.
    const { EmbeddingStore } = await import("../workspace/embeddings/store.js");
    const store = new EmbeddingStore();
    const stored = store.load(index.root);
    if (stored) {
      await api.post(`/workspace/repositories/${repoId}/embeddings`, {
        model: stored.model,
        embeddings: stored.entries.map((e) => ({ path: e.file, vector: e.vector })),
      });
    }
    return true;
  } catch (err) {
    ctx.logger.warn(`Workspace sync failed: ${(err as Error).message}`);
    return false;
  }
}

export async function logSearchHistory(ctx: AppContext, query: string, kind: string, resultCount: number): Promise<boolean> {
  const api = await client();
  if (!api) return false;
  try {
    await api.post("/workspace/search-history", { query, kind, resultCount });
    return true;
  } catch {
    return false;
  }
}

export async function syncCheckpointToBackend(ctx: AppContext, root: string, checkpointId: string, fileCount: number): Promise<boolean> {
  const api = await client();
  if (!api) return false;
  try {
    const index = await loadCachedIndex(root);
    let repositoryId: string | undefined;
    if (index) {
      const repos = await api.get<{ repositories: Array<{ id: string; path: string }> }>("/workspace/repositories");
      repositoryId = repos.body.repositories.find((r) => r.path === index.root)?.id;
    }
    await api.post("/workspace/checkpoints", {
      repositoryId,
      name: checkpointId,
      fileCount,
    });
    return true;
  } catch (err) {
    ctx.logger.warn(`Checkpoint sync failed: ${(err as Error).message}`);
    return false;
  }
}

export async function syncPatchToBackend(ctx: AppContext, root: string, summary: string, diff: string): Promise<boolean> {
  const api = await client();
  if (!api) return false;
  try {
    const index = await loadCachedIndex(root);
    let repositoryId: string | undefined;
    if (index) {
      const repos = await api.get<{ repositories: Array<{ id: string; path: string }> }>("/workspace/repositories");
      repositoryId = repos.body.repositories.find((r) => r.path === index.root)?.id;
    }
    await api.post("/workspace/patches", { repositoryId, summary, diff });
    return true;
  } catch {
    return false;
  }
}
