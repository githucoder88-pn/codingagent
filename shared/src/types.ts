/**
 * CODER — shared domain types (Phase 2).
 *
 * Records exchanged between the CLI, the backend API and the web dashboard.
 */

import type { Role } from "./constants.js";

export interface User {
  id: string;
  email: string;
  hashedPassword?: string;
  firebaseUid?: string;
  createdAt: string;
  updatedAt: string;
  role: Role;
  trainingOptIn: boolean;
  historyEnabled: boolean;
}

/** Public view of a user (never includes hashedPassword). */
export type PublicUser = Omit<User, "hashedPassword">;

export interface ApiSession {
  jti: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}

/** A provider API key stored encrypted by the backend. */
export interface ProviderKeyRecord {
  id: string;
  userId: string;
  provider: string;
  /** Fingerprint (sha256 of the key, hex prefix) for identification. */
  keyHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptRecord {
  id: string;
  userId: string;
  sessionId: string;
  provider: string;
  model: string;
  prompt: string;
  forTraining: boolean;
  clientRecordId?: string;
  createdAt: string;
}

export interface ResponseRecord {
  id: string;
  promptId: string;
  response: string;
  tokensUsed?: number;
  latencyMs?: number;
  createdAt: string;
}

export interface FeedbackRecord {
  id: string;
  userId: string;
  promptId?: string;
  rating: number;
  comment?: string;
  createdAt: string;
}

export interface AuditLogRecord {
  id: string;
  actorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: string;
  createdAt: string;
}

/** User privacy settings (mirrored locally in ~/.coder/settings.json). */
export interface PrivacySettings {
  /** Record prompts/responses (chat history) — default true. */
  historyEnabled: boolean;
  /** Opt into training-data collection — default false, always explicit. */
  trainingOptIn: boolean;
}

export interface UserStats {
  promptCount: number;
  responseCount: number;
  feedbackCount: number;
  keyCount: number;
  firstPromptAt: string | null;
  lastPromptAt: string | null;
}

/** A history item as returned by GET /api/chat/history. */
export interface HistoryItem {
  promptId: string;
  sessionId: string;
  provider: string;
  model: string;
  prompt: string;
  response?: string;
  tokensUsed?: number;
  latencyMs?: number;
  rating?: number;
  feedbackComment?: string;
  createdAt: string;
}

/** Admin-facing usage rollups. */
export interface UsageStats {
  days: number;
  promptsPerDay: Array<{ day: string; count: number }>;
  byProvider: Array<{ provider: string; count: number }>;
  byModel: Array<{ model: string; count: number }>;
  avgLatencyMs: number | null;
  totalTokens: number;
}

export interface TrainingStats {
  optInCount: number;
  totalUsers: number;
  datasetPromptCount: number;
}

/** One training-dataset row (admin only). */
export interface TrainingRow {
  promptId: string;
  userId: string;
  provider: string;
  model: string;
  prompt: string;
  response?: string;
  rating?: number;
  feedbackComment?: string;
  createdAt: string;
}

/** Data bundle returned by POST /api/export. */
export interface ExportBundle {
  exportedAt: string;
  user: PublicUser;
  settings: PrivacySettings;
  providerKeys: Array<{ provider: string; fingerprint: string; createdAt: string }>;
  prompts: PromptRecord[];
  responses: ResponseRecord[];
  feedback: FeedbackRecord[];
}

/** Auth responses. */
export interface AuthResponse {
  token: string;
  user: PublicUser;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
