/**
 * CODER — shared constants (Phase 2).
 */

/** Default backend HTTP endpoint. */
export const API_DEFAULT_HOST = "127.0.0.1";
export const API_DEFAULT_PORT = 8747;
export const API_PREFIX = "/api";
export const API_HEALTH_PATH = "/api/health";

/** Token lifetime for API sessions (7 days). */
export const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Accepted provider ids for stored provider keys. */
export const KEY_PROVIDERS = ["openai", "anthropic", "gemini", "openrouter"] as const;

/** Rating range for feedback records. */
export const FEEDBACK_MIN_RATING = 1;
export const FEEDBACK_MAX_RATING = 5;

/** Roles understood by the backend. */
export const ROLES = ["user", "admin", "superadmin"] as const;
export type Role = (typeof ROLES)[number];

/** Id prefixes used across the platform. */
export const ID_PREFIX = {
  user: "u",
  session: "sess",
  prompt: "pr",
  response: "rs",
  feedback: "fb",
  audit: "au",
  key: "pk",
  record: "rec",
} as const;
