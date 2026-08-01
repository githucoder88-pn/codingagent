/**
 * CODER backend — database.
 *
 * SQLite via Node's built-in `node:sqlite` (loaded lazily so bundlers leave
 * the specifier alone — same trick as the CLI's SqliteStore). Synchronous
 * access is fine for a single-process local control plane.
 */

type SqliteModule = typeof import("node:sqlite");
type DatabaseSync = InstanceType<SqliteModule["DatabaseSync"]>;

let modulePromise: Promise<SqliteModule> | null = null;

async function loadSqlite(): Promise<SqliteModule> {
  modulePromise ??= import(`node:${"sqlite"}`);
  return modulePromise;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  hashed_password TEXT,
  firebase_uid TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin','superadmin')),
  training_opt_in INTEGER NOT NULL DEFAULT 0,
  history_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_sessions (
  jti TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS provider_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  client_record_id TEXT,
  for_training INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, client_record_id)
);

CREATE TABLE IF NOT EXISTS responses (
  id TEXT PRIMARY KEY,
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  response TEXT NOT NULL,
  tokens_used INTEGER,
  latency_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt_id TEXT REFERENCES prompts(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS training_consent (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  opted_in INTEGER NOT NULL,
  consented_at TEXT,
  revoked_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_metadata (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (provider, model)
);

CREATE INDEX IF NOT EXISTS idx_prompts_user ON prompts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompts_training ON prompts(for_training, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_responses_prompt ON responses(prompt_id);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON api_sessions(user_id);
`;

export class Database {
  private db: DatabaseSync | null = null;
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  static async open(path: string): Promise<Database> {
    const database = new Database(path);
    await database.open();
    return database;
  }

  private async open(): Promise<void> {
    const mod = await loadSqlite();
    this.db = new mod.DatabaseSync(this.path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA busy_timeout = 3000;");
    this.db.exec(SCHEMA);
  }

  get raw(): DatabaseSync {
    if (!this.db) throw new Error("Database not open");
    return this.db;
  }

  close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        /* best effort */
      }
      this.db = null;
    }
  }

  /** Run a callback inside a transaction. */
  transaction<T>(fn: () => T): T {
    const db = this.raw;
    db.exec("BEGIN");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

export type { DatabaseSync };
