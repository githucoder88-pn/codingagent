/**
 * CODER — model catalogue cache.
 *
 * `coder models` hits the provider API; results are cached in SQLite so the
 * command stays fast and works offline (with a staleness warning). The
 * cache is a service because it is also used to resolve "current model"
 * metadata without a network round-trip.
 */

import { type Model } from "../types/index.js";
import { type SqliteStore } from "../session/storage/sqlite-store.js";

export interface CachedModels {
  models: Model[];
  fetchedAt: string;
}

export class ModelCache {
  constructor(private readonly store: SqliteStore) {}

  async get(provider: string): Promise<CachedModels | undefined> {
    const row = await this.store.modelCacheGet(provider);
    if (!row) return undefined;
    try {
      return { models: JSON.parse(row.payload) as Model[], fetchedAt: row.fetchedAt };
    } catch {
      return undefined;
    }
  }

  async set(provider: string, models: Model[]): Promise<void> {
    await this.store.modelCacheSet(provider, JSON.stringify(models));
  }
}
