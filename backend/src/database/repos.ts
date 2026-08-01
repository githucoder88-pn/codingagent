/**
 * CODER backend — repositories.
 *
 * Thin typed data-access functions over the SQLite database. Rows are
 * mapped to shared domain types.
 */

import { randomId } from "../../../shared/src/index.js";
import type {
  AuditLogRecord,
  FeedbackRecord,
  PromptRecord,
  ProviderKeyRecord,
  ResponseRecord,
  TrainingRow,
  User,
  UserStats,
} from "../../../shared/src/index.js";
import { Database } from "./db.js";

const now = () => new Date().toISOString();

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    email: String(row.email),
    hashedPassword: row.hashed_password === null ? undefined : String(row.hashed_password),
    firebaseUid: row.firebase_uid === null ? undefined : String(row.firebase_uid),
    role: String(row.role) as User["role"],
    trainingOptIn: Boolean(row.training_opt_in),
    historyEnabled: Boolean(row.history_enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// ----------------------------------------------------------------- users

export interface UserRow extends User {
  promptCount?: number;
  lastActiveAt?: string | null;
}

export function findUserByEmail(db: Database, email: string): User | undefined {
  const row = db.raw.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase()) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToUser(row) : undefined;
}

export function findUserById(db: Database, id: string): User | undefined {
  const row = db.raw.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToUser(row) : undefined;
}

export function findUserByFirebaseUid(db: Database, uid: string): User | undefined {
  const row = db.raw.prepare("SELECT * FROM users WHERE firebase_uid = ?").get(uid) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToUser(row) : undefined;
}

export function createUser(
  db: Database,
  input: { email: string; hashedPassword?: string; firebaseUid?: string; role?: User["role"] },
): User {
  const user: User = {
    id: randomId("u"),
    email: input.email.toLowerCase(),
    hashedPassword: input.hashedPassword,
    firebaseUid: input.firebaseUid,
    role: input.role ?? "user",
    trainingOptIn: false,
    historyEnabled: true,
    createdAt: now(),
    updatedAt: now(),
  };
  db.raw
    .prepare(
      `INSERT INTO users (id, email, hashed_password, firebase_uid, role, training_opt_in, history_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)`,
    )
    .run(user.id, user.email, user.hashedPassword ?? null, user.firebaseUid ?? null, user.role, user.createdAt, user.updatedAt);
  return user;
}

export function updateUserSettings(
  db: Database,
  userId: string,
  patch: { historyEnabled?: boolean; trainingOptIn?: boolean },
): User {
  const user = findUserById(db, userId);
  if (!user) throw new Error(`user ${userId} not found`);
  const historyEnabled = patch.historyEnabled ?? user.historyEnabled;
  const trainingOptIn = patch.trainingOptIn ?? user.trainingOptIn;
  db.raw
    .prepare("UPDATE users SET history_enabled = ?, training_opt_in = ?, updated_at = ? WHERE id = ?")
    .run(historyEnabled ? 1 : 0, trainingOptIn ? 1 : 0, now(), userId);
  return findUserById(db, userId)!;
}

export function setUserRole(db: Database, userId: string, role: User["role"]): void {
  db.raw.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(role, now(), userId);
}

export function deleteUser(db: Database, userId: string): void {
  db.raw.prepare("DELETE FROM users WHERE id = ?").run(userId);
}

export function listUsers(
  db: Database,
  opts: { limit: number; offset: number; search?: string },
): { users: UserRow[]; total: number } {
  const { limit, offset } = opts;
  const search = opts.search?.trim();
  const where = search ? "WHERE u.email LIKE ?" : "";
  const params = search ? [`%${search}%`] : [];
  const totalRow = db.raw
    .prepare(`SELECT COUNT(*) AS c FROM users u ${where}`)
    .get(...params) as { c: number };
  const rows = db.raw
    .prepare(
      `SELECT u.*, (SELECT COUNT(*) FROM prompts p WHERE p.user_id = u.id) AS prompt_count,
              (SELECT MAX(p.created_at) FROM prompts p WHERE p.user_id = u.id) AS last_active_at
       FROM users u ${where}
       ORDER BY u.created_at ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Array<Record<string, unknown>>;
  return {
    total: totalRow.c,
    users: rows.map((row) => ({
      ...rowToUser(row),
      promptCount: Number(row.prompt_count ?? 0),
      lastActiveAt: row.last_active_at === null ? null : String(row.last_active_at),
    })),
  };
}

export function countUsers(db: Database): number {
  const row = db.raw.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  return row.c;
}

// ------------------------------------------------------------- sessions

export function createApiSession(
  db: Database,
  jti: string,
  userId: string,
  expiresAt: string,
): void {
  db.raw
    .prepare("INSERT INTO api_sessions (jti, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(jti, userId, now(), expiresAt);
}

export function revokeApiSession(db: Database, jti: string): void {
  db.raw.prepare("UPDATE api_sessions SET revoked_at = ? WHERE jti = ?").run(now(), jti);
}

export function revokeAllUserSessions(db: Database, userId: string): void {
  db.raw.prepare("UPDATE api_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(now(), userId);
}

export function apiSessionActive(db: Database, jti: string, nowIso: string): boolean {
  const row = db.raw
    .prepare("SELECT 1 AS ok FROM api_sessions WHERE jti = ? AND revoked_at IS NULL AND expires_at > ?")
    .get(jti, nowIso) as { ok: number } | undefined;
  return row !== undefined;
}

// -------------------------------------------------------- provider keys

export function upsertProviderKey(
  db: Database,
  input: { userId: string; provider: string; encryptedKey: string; keyHash: string },
): ProviderKeyRecord {
  const existing = db.raw
    .prepare("SELECT id FROM provider_keys WHERE user_id = ? AND provider = ?")
    .get(input.userId, input.provider) as { id: string } | undefined;
  const id = existing?.id ?? randomId("pk");
  const timestamp = now();
  if (existing) {
    db.raw
      .prepare("UPDATE provider_keys SET encrypted_key = ?, key_hash = ?, updated_at = ? WHERE id = ?")
      .run(input.encryptedKey, input.keyHash, timestamp, id);
  } else {
    db.raw
      .prepare(
        "INSERT INTO provider_keys (id, user_id, provider, encrypted_key, key_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, input.userId, input.provider, input.encryptedKey, input.keyHash, timestamp, timestamp);
  }
  return {
    id,
    userId: input.userId,
    provider: input.provider,
    keyHash: input.keyHash,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function listProviderKeys(db: Database, userId: string): ProviderKeyRecord[] {
  const rows = db.raw
    .prepare("SELECT * FROM provider_keys WHERE user_id = ? ORDER BY provider ASC")
    .all(userId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    provider: String(row.provider),
    keyHash: String(row.key_hash),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
}

export function getProviderKeyRow(db: Database, userId: string, provider: string) {
  const row = db.raw
    .prepare("SELECT * FROM provider_keys WHERE user_id = ? AND provider = ?")
    .get(userId, provider) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    provider: String(row.provider),
    encryptedKey: String(row.encrypted_key),
    keyHash: String(row.key_hash),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function deleteProviderKey(db: Database, userId: string, provider: string): boolean {
  const result = db.raw.prepare("DELETE FROM provider_keys WHERE user_id = ? AND provider = ?").run(userId, provider);
  return result.changes > 0;
}

/** All encrypted keys (used by admin key rotation). */
export function allProviderKeyRows(db: Database) {
  const rows = db.raw.prepare("SELECT id, encrypted_key FROM provider_keys").all() as Array<{
    id: string;
    encrypted_key: string;
  }>;
  return rows.map((row) => ({ id: row.id, encryptedKey: row.encrypted_key }));
}

export function updateEncryptedKey(db: Database, id: string, encryptedKey: string): void {
  db.raw
    .prepare("UPDATE provider_keys SET encrypted_key = ?, updated_at = ? WHERE id = ?")
    .run(encryptedKey, now(), id);
}

// ------------------------------------------------------------- prompts

export function insertPrompt(
  db: Database,
  input: {
    userId: string;
    sessionId: string;
    provider: string;
    model: string;
    prompt: string;
    forTraining: boolean;
    clientRecordId?: string;
  },
): PromptRecord {
  const id = randomId("pr");
  const timestamp = now();
  db.raw
    .prepare(
      `INSERT INTO prompts (id, user_id, session_id, provider, model, prompt, client_record_id, for_training, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.userId, input.sessionId, input.provider, input.model, input.prompt, input.clientRecordId ?? null, input.forTraining ? 1 : 0, timestamp);
  // Track provider/model metadata (usage rollups + catalogue stats).
  db.raw
    .prepare(
      `INSERT INTO model_metadata (provider, model, first_seen_at, last_seen_at, usage_count)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(provider, model) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         usage_count = model_metadata.usage_count + 1`,
    )
    .run(input.provider, input.model, timestamp, timestamp);
  return {
    id,
    userId: input.userId,
    sessionId: input.sessionId,
    provider: input.provider,
    model: input.model,
    prompt: input.prompt,
    forTraining: input.forTraining,
    clientRecordId: input.clientRecordId,
    createdAt: timestamp,
  };
}

export function findPromptByClientRecordId(db: Database, userId: string, clientRecordId: string): PromptRecord | undefined {
  const row = db.raw
    .prepare("SELECT * FROM prompts WHERE user_id = ? AND client_record_id = ?")
    .get(userId, clientRecordId) as Record<string, unknown> | undefined;
  return row ? rowToPrompt(row) : undefined;
}

export function findPromptById(db: Database, id: string): PromptRecord | undefined {
  const row = db.raw.prepare("SELECT * FROM prompts WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToPrompt(row) : undefined;
}

function rowToPrompt(row: Record<string, unknown>): PromptRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    sessionId: String(row.session_id),
    provider: String(row.provider),
    model: String(row.model),
    prompt: String(row.prompt),
    forTraining: Boolean(row.for_training),
    clientRecordId: row.client_record_id === null ? undefined : String(row.client_record_id),
    createdAt: String(row.created_at),
  };
}

// ----------------------------------------------------------- responses

export function insertResponse(
  db: Database,
  input: { promptId: string; response: string; tokensUsed?: number; latencyMs?: number },
): ResponseRecord {
  const id = randomId("rs");
  const timestamp = now();
  db.raw
    .prepare(
      "INSERT INTO responses (id, prompt_id, response, tokens_used, latency_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(id, input.promptId, input.response, input.tokensUsed ?? null, input.latencyMs ?? null, timestamp);
  return { id, promptId: input.promptId, response: input.response, tokensUsed: input.tokensUsed, latencyMs: input.latencyMs, createdAt: timestamp };
}

export function getResponseForPrompt(db: Database, promptId: string): ResponseRecord | undefined {
  const row = db.raw.prepare("SELECT * FROM responses WHERE prompt_id = ?").get(promptId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    id: String(row.id),
    promptId: String(row.prompt_id),
    response: String(row.response),
    tokensUsed: row.tokens_used === null ? undefined : Number(row.tokens_used),
    latencyMs: row.latency_ms === null ? undefined : Number(row.latency_ms),
    createdAt: String(row.created_at),
  };
}

// ------------------------------------------------------------ feedback

export function insertFeedback(
  db: Database,
  input: { userId: string; promptId?: string; rating: number; comment?: string },
): FeedbackRecord {
  const id = randomId("fb");
  const timestamp = now();
  db.raw
    .prepare("INSERT INTO feedback (id, user_id, prompt_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, input.userId, input.promptId ?? null, input.rating, input.comment ?? null, timestamp);
  return { id, userId: input.userId, promptId: input.promptId, rating: input.rating, comment: input.comment, createdAt: timestamp };
}

export function listFeedback(db: Database, opts: { limit: number; offset: number }) {
  const rows = db.raw
    .prepare(
      `SELECT f.*, u.email AS user_email, p.prompt AS prompt_excerpt
       FROM feedback f
       JOIN users u ON u.id = f.user_id
       LEFT JOIN prompts p ON p.id = f.prompt_id
       ORDER BY f.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(opts.limit, opts.offset) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    promptId: row.prompt_id === null ? undefined : String(row.prompt_id),
    rating: Number(row.rating),
    comment: row.comment === null ? undefined : String(row.comment),
    createdAt: String(row.created_at),
    userEmail: String(row.user_email),
    promptExcerpt: row.prompt_excerpt === null ? undefined : String(row.prompt_excerpt).slice(0, 300),
  }));
}

// -------------------------------------------------------------- history

export function historyForUser(
  db: Database,
  userId: string,
  opts: { limit: number; offset: number; sessionId?: string },
) {
  const where = ["p.user_id = ?"];
  const params: Array<string | number> = [userId];
  if (opts.sessionId) {
    where.push("p.session_id = ?");
    params.push(opts.sessionId);
  }
  const rows = db.raw
    .prepare(
      `SELECT p.id AS prompt_id, p.session_id, p.provider, p.model, p.prompt, p.created_at,
              r.response, r.tokens_used, r.latency_ms,
              f.rating, f.comment AS feedback_comment
       FROM prompts p
       LEFT JOIN responses r ON r.prompt_id = p.id
       LEFT JOIN feedback f ON f.prompt_id = p.id
       WHERE ${where.join(" AND ")}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, opts.limit, opts.offset) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    promptId: String(row.prompt_id),
    sessionId: String(row.session_id),
    provider: String(row.provider),
    model: String(row.model),
    prompt: String(row.prompt),
    response: row.response === null ? undefined : String(row.response),
    tokensUsed: row.tokens_used === null ? undefined : Number(row.tokens_used),
    latencyMs: row.latency_ms === null ? undefined : Number(row.latency_ms),
    rating: row.rating === null ? undefined : Number(row.rating),
    feedbackComment: row.feedback_comment === null ? undefined : String(row.feedback_comment),
    createdAt: String(row.created_at),
  }));
}

export function countPromptsForUser(db: Database, userId: string): number {
  const row = db.raw.prepare("SELECT COUNT(*) AS c FROM prompts WHERE user_id = ?").get(userId) as { c: number };
  return row.c;
}

export function userStats(db: Database, userId: string): UserStats {
  const prompts = db.raw
    .prepare("SELECT COUNT(*) AS c, MIN(created_at) AS first, MAX(created_at) AS last FROM prompts WHERE user_id = ?")
    .get(userId) as { c: number; first: string | null; last: string | null };
  const responses = db.raw.prepare("SELECT COUNT(*) AS c FROM responses r JOIN prompts p ON p.id = r.prompt_id WHERE p.user_id = ?").get(userId) as { c: number };
  const feedback = db.raw.prepare("SELECT COUNT(*) AS c FROM feedback WHERE user_id = ?").get(userId) as { c: number };
  const keys = db.raw.prepare("SELECT COUNT(*) AS c FROM provider_keys WHERE user_id = ?").get(userId) as { c: number };
  return {
    promptCount: prompts.c,
    responseCount: responses.c,
    feedbackCount: feedback.c,
    keyCount: keys.c,
    firstPromptAt: prompts.first,
    lastPromptAt: prompts.last,
  };
}

// -------------------------------------------------------------- training

export function trainingStats(db: Database): {
  optInCount: number;
  totalUsers: number;
  datasetPromptCount: number;
} {
  const opted = db.raw.prepare("SELECT COUNT(*) AS c FROM users WHERE training_opt_in = 1").get() as { c: number };
  const total = db.raw.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  const dataset = db.raw.prepare("SELECT COUNT(*) AS c FROM prompts WHERE for_training = 1").get() as { c: number };
  return { optInCount: opted.c, totalUsers: total.c, datasetPromptCount: dataset.c };
}

export function trainingDataset(
  db: Database,
  opts: { limit: number; offset: number },
): TrainingRow[] {
  const rows = db.raw
    .prepare(
      `SELECT p.id AS prompt_id, p.user_id, p.provider, p.model, p.prompt, p.created_at,
              r.response, f.rating, f.comment AS feedback_comment
       FROM prompts p
       LEFT JOIN responses r ON r.prompt_id = p.id
       LEFT JOIN feedback f ON f.prompt_id = p.id
       WHERE p.for_training = 1
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(opts.limit, opts.offset) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    promptId: String(row.prompt_id),
    userId: String(row.user_id),
    provider: String(row.provider),
    model: String(row.model),
    prompt: String(row.prompt),
    response: row.response === null ? undefined : String(row.response),
    rating: row.rating === null ? undefined : Number(row.rating),
    feedbackComment: row.feedback_comment === null ? undefined : String(row.feedback_comment),
    createdAt: String(row.created_at),
  }));
}

export function setTrainingConsent(
  db: Database,
  userId: string,
  optedIn: boolean,
): void {
  const timestamp = now();
  const existing = db.raw.prepare("SELECT opted_in FROM training_consent WHERE user_id = ?").get(userId) as
    | { opted_in: number }
    | undefined;
  if (existing) {
    db.raw
      .prepare(
        `UPDATE training_consent SET opted_in = ?, revoked_at = CASE WHEN ? THEN NULL ELSE ? END, updated_at = ? WHERE user_id = ?`,
      )
      .run(optedIn ? 1 : 0, optedIn ? 1 : 0, optedIn ? null : timestamp, timestamp, userId);
  } else {
    db.raw
      .prepare(
        "INSERT INTO training_consent (user_id, opted_in, consented_at, revoked_at, updated_at) VALUES (?, ?, ?, NULL, ?)",
      )
      .run(userId, optedIn ? 1 : 0, optedIn ? timestamp : null, timestamp);
  }
}

// ---------------------------------------------------------------- audit

export function writeAudit(
  db: Database,
  input: { actorId?: string; action: string; targetType?: string; targetId?: string; metadata?: unknown },
): AuditLogRecord {
  const record: AuditLogRecord = {
    id: randomId("au"),
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata === undefined ? undefined : JSON.stringify(input.metadata),
    createdAt: now(),
  };
  db.raw
    .prepare(
      "INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(record.id, record.actorId ?? null, record.action, record.targetType ?? null, record.targetId ?? null, record.metadata ?? null, record.createdAt);
  return record;
}

export function listAuditLogs(
  db: Database,
  opts: { limit: number; offset: number; action?: string },
) {
  const where = opts.action ? "WHERE action = ?" : "";
  const params: Array<string | number> = opts.action ? [opts.action] : [];
  const rows = db.raw
    .prepare(
      `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, opts.limit, opts.offset) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    actorId: row.actor_id === null ? undefined : String(row.actor_id),
    action: String(row.action),
    targetType: row.target_type === null ? undefined : String(row.target_type),
    targetId: row.target_id === null ? undefined : String(row.target_id),
    metadata: row.metadata === null ? undefined : String(row.metadata),
    createdAt: String(row.created_at),
  }));
}

// ------------------------------------------------------ model metadata

export interface ModelMetadataRow {
  provider: string;
  model: string;
  firstSeenAt: string;
  lastSeenAt: string;
  usageCount: number;
}

export function listModelMetadata(db: Database, opts: { limit: number; offset: number; provider?: string }): ModelMetadataRow[] {
  const where = opts.provider ? "WHERE provider = ?" : "";
  const params: Array<string | number> = opts.provider ? [opts.provider] : [];
  const rows = db.raw
    .prepare(
      `SELECT provider, model, first_seen_at, last_seen_at, usage_count
       FROM model_metadata ${where}
       ORDER BY usage_count DESC, last_seen_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, opts.limit, opts.offset) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    provider: String(row.provider),
    model: String(row.model),
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    usageCount: Number(row.usage_count),
  }));
}

// ---------------------------------------------------------------- usage

export function usageRollups(db: Database, days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const perDay = db.raw
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c
       FROM prompts WHERE created_at >= ? GROUP BY day ORDER BY day ASC`,
    )
    .all(since) as Array<{ day: string; c: number }>;
  const byProvider = db.raw
    .prepare("SELECT provider, COUNT(*) AS c FROM prompts WHERE created_at >= ? GROUP BY provider ORDER BY c DESC")
    .all(since) as Array<{ provider: string; c: number }>;
  const byModel = db.raw
    .prepare("SELECT model, COUNT(*) AS c FROM prompts WHERE created_at >= ? GROUP BY model ORDER BY c DESC LIMIT 10")
    .all(since) as Array<{ model: string; c: number }>;
  const latency = db.raw
    .prepare(
      `SELECT AVG(r.latency_ms) AS avg_ms, SUM(COALESCE(r.tokens_used, 0)) AS tokens
       FROM responses r JOIN prompts p ON p.id = r.prompt_id WHERE p.created_at >= ?`,
    )
    .get(since) as { avg_ms: number | null; tokens: number | null };
  return {
    days,
    promptsPerDay: perDay.map((row) => ({ day: row.day, count: row.c })),
    byProvider: byProvider.map((row) => ({ provider: row.provider, count: row.c })),
    byModel: byModel.map((row) => ({ model: row.model, count: row.c })),
    avgLatencyMs: latency.avg_ms === null ? null : Math.round(latency.avg_ms),
    totalTokens: latency.tokens ?? 0,
  };
}

/** Admin prompt listing (joined with user email). */
export function adminPrompts(db: Database, opts: { limit: number; offset: number }) {
  const rows = db.raw
    .prepare(
      `SELECT p.*, u.email AS user_email, r.response AS response_excerpt, r.latency_ms, r.tokens_used
       FROM prompts p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN responses r ON r.prompt_id = p.id
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(opts.limit, opts.offset) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    userEmail: String(row.user_email),
    sessionId: String(row.session_id),
    provider: String(row.provider),
    model: String(row.model),
    prompt: String(row.prompt).slice(0, 500),
    forTraining: Boolean(row.for_training),
    createdAt: String(row.created_at),
    responseExcerpt: row.response_excerpt === null ? undefined : String(row.response_excerpt).slice(0, 300),
    latencyMs: row.latency_ms === null ? undefined : Number(row.latency_ms),
    tokensUsed: row.tokens_used === null ? undefined : Number(row.tokens_used),
  }));
}
