/**
 * CODER — SQLite storage.
 *
 * Thin wrapper around Node's built-in `node:sqlite` (DatabaseSync). Used for
 * durable key/value metadata, the model catalogue cache and (in later
 * phases) richer indexes.
 *
 * The module is loaded lazily via a runtime dynamic import (`"node:" +
 * "sqlite"`) so bundlers leave the specifier alone; if `node:sqlite` is
 * unavailable the store falls back to a JSON file and the CLI keeps
 * working everywhere.
 */

import { paths, readJson, writeJson } from "../../utils/paths.js";

type SqliteModule = typeof import("node:sqlite");
type DatabaseSync = InstanceType<SqliteModule["DatabaseSync"]>;

interface KvRow {
  value?: string;
}

interface ModelCacheRow {
  payload?: string;
  fetched_at?: string;
}

export class SqliteStore {
  private db: DatabaseSync | null = null;
  private fallback: Map<string, string> = new Map();
  private initPromise: Promise<boolean> | null = null;

  /** Lazily open the database (or fall back to JSON storage). Idempotent. */
  private ensureOpen(): Promise<boolean> {
    this.initPromise ??= this.open();
    return this.initPromise;
  }

  private async open(): Promise<boolean> {
    try {
      const mod = await import(`node:${"sqlite"}`);
      const db = new mod.DatabaseSync(paths.cacheDb());
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 3000;
        CREATE TABLE IF NOT EXISTS kv (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS model_cache (
          provider TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          fetched_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS message_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      this.db = db as DatabaseSync;
      return true;
    } catch {
      // node:sqlite unavailable (older Node) → JSON-file fallback.
      this.db = null;
      this.loadFallback();
      return false;
    }
  }

  async sqliteAvailable(): Promise<boolean> {
    return (await this.ensureOpen()) && this.db !== null;
  }

  async close(): Promise<void> {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        /* best effort */
      }
      this.db = null;
      return;
    }
    // Only persist the JSON fallback when it actually holds data (avoids
    // creating a stray store.json on runs that never touched storage).
    if (this.fallback.size > 0) {
      this.saveFallback();
    }
  }

  // ------------------------------------------------------------------- kv

  async kvGet(key: string): Promise<string | undefined> {
    await this.ensureOpen();
    if (this.db) {
      const row = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as KvRow | undefined;
      return row?.value;
    }
    return this.fallback.get(key);
  }

  async kvSet(key: string, value: string): Promise<void> {
    await this.ensureOpen();
    if (this.db) {
      this.db
        .prepare(
          "INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) " +
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        )
        .run(key, value, new Date().toISOString());
      return;
    }
    this.fallback.set(key, value);
  }

  // ---------------------------------------------------------- model cache

  async modelCacheGet(provider: string): Promise<{ payload: string; fetchedAt: string } | undefined> {
    await this.ensureOpen();
    if (this.db) {
      const row = this.db
        .prepare("SELECT payload, fetched_at FROM model_cache WHERE provider = ?")
        .get(provider) as ModelCacheRow | undefined;
      if (!row || row.payload === undefined || row.fetched_at === undefined) return undefined;
      return { payload: row.payload, fetchedAt: row.fetched_at };
    }
    const raw = this.fallback.get(`models:${provider}`);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as { payload: string; fetchedAt: string };
    } catch {
      return undefined;
    }
  }

  async modelCacheSet(provider: string, payload: string): Promise<void> {
    await this.ensureOpen();
    const fetchedAt = new Date().toISOString();
    if (this.db) {
      this.db
        .prepare(
          "INSERT INTO model_cache (provider, payload, fetched_at) VALUES (?, ?, ?) " +
            "ON CONFLICT(provider) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at",
        )
        .run(provider, payload, fetchedAt);
      return;
    }
    this.fallback.set(`models:${provider}`, JSON.stringify({ payload, fetchedAt }));
  }

  // ------------------------------------------------------------ fallback

  private loadFallback(): void {
    const raw = readJson<Record<string, string>>(paths.cacheJson());
    if (raw) {
      for (const [key, value] of Object.entries(raw)) this.fallback.set(key, value);
    }
  }

  private saveFallback(): void {
    writeJson(paths.cacheJson(), Object.fromEntries(this.fallback));
  }
}
