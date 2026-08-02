/**
 * CODER — core constants.
 *
 * Central place for application-wide constants: identity, filesystem layout,
 * defaults and exit codes. Kept dependency-free so any module can import it.
 */

export const APP_NAME = "coder";
export const APP_DISPLAY_NAME = "CODER";
export const VERSION = "7.0.0";
export const PHASE = "Phase 11 — Offline-First Runtime, Personal Mode, Persistent Pet Mode";

/** Default directory holding all user data: `~/.coder` (override with CODER_HOME). */
export const DEFAULT_CONFIG_DIR_NAME = ".coder";

/** Names of files/directories inside the CODER home directory. */
export const FILES = {
  config: "config.json",
  providers: "providers.json",
  sessionsDir: "sessions",
  logsDir: "logs",
  cacheDir: "cache",
  cacheDb: "cache/coder.db",
  cacheJson: "cache/store.json",
  currentSession: "sessions/current.json",
  // Phase 2 — account & data plane
  session: "session.json",
  settings: "settings.json",
  records: "records.json",
  vault: "vault.json",
  keysDir: "keys",
  serverDir: "server",
} as const;

/** Default `~/.coder/config.json` values (see also src/config/defaults). */
export const DEFAULTS = {
  provider: "openrouter",
  model: null as string | null,
  theme: "default",
  stream: true,
} as const;

/** Log file names written to `~/.coder/logs`. */
export const LOG_FILES = {
  error: "error.log",
  debug: "debug.log",
  latest: "latest.log",
} as const;

/** Rotate a log file once it exceeds this size (bytes). */
export const LOG_ROTATE_BYTES = 5 * 1024 * 1024; // 5 MB

/** How long `coder models` results stay cached (ms) before refresh. */
export const MODELS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

/** Maximum messages retained in a session before trimming (memory guard). */
export const SESSION_MAX_MESSAGES = 200;

/** HTTP request timeouts. */
export const HTTP_TIMEOUT_MS = 60_000;
export const STREAM_IDLE_TIMEOUT_MS = 60_000;

/**
 * Process exit codes. Keep them stable — scripts and CI depend on them.
 */
export const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  AUTH: 3,
  NETWORK: 4,
  PROVIDER: 5,
  CONFIG: 6,
  INTERRUPTED: 130,
} as const;

/** Registered provider ids. `mock` is a built-in offline provider used by
 *  development, smoke tests and e2e tests (no network, no API key). The
 *  Phase 8 global network adds OpenAI-compatible providers. */
export const PROVIDER_IDS = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "groq",
  "deepseek",
  "cohere",
  "together",
  "xai",
  "azure",
  "bedrock",
  "litellm",
  "ollama",
  "mock",
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Environment variables honoured by CODER. */
export const ENV = {
  home: "CODER_HOME", // relocate the ~/.coder directory (tests, portable installs)
  debug: "CODER_DEBUG", // 1|true → verbose console logging
  provider: "CODER_PROVIDER", // override configured provider
  model: "CODER_MODEL", // override configured model
  stream: "CODER_STREAM", // 0|false → disable streaming
  theme: "CODER_THEME", // override theme
  noColor: "NO_COLOR", // standard: disable ANSI colours
} as const;
