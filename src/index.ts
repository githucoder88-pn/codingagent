/**
 * CODER — public API.
 *
 * Everything a programmatic consumer or a test needs: application bootstrap,
 * container, config, sessions, providers, logger and the CLI runner.
 */

// Application core
export {
  createApp,
  shutdownApp,
  buildContainer,
  TOKENS,
} from "./core/application/application.js";
export type { AppContext, CreateAppOptions } from "./core/application/application.js";
export { bootstrap } from "./core/lifecycle/bootstrap.js";
export { Container } from "./core/container/container.js";
export type { Factory } from "./core/container/container.js";
export {
  CoderError,
  UsageError,
  ConfigError,
  AuthError,
  NetworkError,
  ProviderError,
  SessionError,
  toCoderError,
} from "./core/errors/index.js";
export { VERSION, APP_NAME, APP_DISPLAY_NAME, EXIT } from "./core/constants/index.js";

// CLI
export { runCli, main } from "./cli.js";
export { buildProgram } from "./commands/index.js";

// Phase 2 — account & sync
export { ApiClient, resolveServerUrl, defaultServerUrl } from "./account/api-client.js";
export { loadSession, saveSession, clearSession, requireSession } from "./account/session-store.js";
export { loadSettings, saveSettings, setPrivacyProfile } from "./account/settings.js";
export { loadRecords, appendRecord, updateRecord, latestRecord } from "./account/records.js";
export { vault } from "./account/vault.js";
export { recordTurn } from "./account/recorder.js";
export { syncRecords, syncProviderKey } from "./sync/sync.js";

// Phase 2 — backend (control plane)
export { createServer as createBackendServer, webRoot } from "../backend/src/server.js";
export { loadConfig as loadBackendConfig } from "../backend/src/config.js";
export { KeyManager } from "../backend/src/encryption/key-manager.js";
export { verifyFirebaseToken } from "../backend/src/auth/auth.js";

// Phase 3 — workspace intelligence
export { WorkspaceManager } from "./workspace/workspace-manager.js";
export { RepositoryScanner } from "./workspace/repository/scanner.js";
export { indexRepository, loadCachedIndex } from "./workspace/indexer/indexer.js";
export { SearchEngine } from "./workspace/search/search-engine.js";
export { DependencyGraph } from "./workspace/dependency/graph.js";
export { ContextEngine } from "./workspace/context/engine.js";
export { EmbeddingStore } from "./workspace/embeddings/store.js";
export { LocalHashEmbeddingProvider, cosineSimilarity, rankBySimilarity } from "./workspace/embeddings/embeddings.js";
export { parseFile } from "./workspace/parser/index.js";
export { ALL_TOOLS, getTool, listTools, renderToolSchema } from "./tools/registry.js";
export { ExecutionScheduler } from "./execution/scheduler.js";
export { ExecutionLedger } from "./execution/ledger.js";
export { RollbackManager } from "./execution/rollback.js";
export { checkPermission, levelAllows } from "./execution/permissions.js";
export { isDeniedCommand } from "./execution/sandbox.js";
export { runAgent, parseToolCall } from "./execution/agent.js";
export { computeDiff, applyUnifiedPatch } from "./tools/patch.js";

// Configuration
export { ConfigManager } from "./config/manager/config-manager.js";
export { configSchema, providersSchema } from "./config/schema/schema.js";
export { CONFIG_DEFAULTS, AVAILABLE_THEMES } from "./config/defaults/index.js";

// Providers
export { ProviderRegistry } from "./providers/registry.js";
export { BaseProvider } from "./providers/base/provider.base.js";
export type { Provider } from "./providers/base/provider.interface.js";
export { HttpClient } from "./providers/http-client.js";
export { ModelCache } from "./providers/model-cache.js";
export { MockProvider } from "./providers/mock/mock.provider.js";
export { OpenAiProvider } from "./providers/openai/openai.provider.js";
export { AnthropicProvider } from "./providers/anthropic/anthropic.provider.js";
export { GeminiProvider } from "./providers/gemini/gemini.provider.js";
export { OpenRouterProvider } from "./providers/openrouter/openrouter.provider.js";
export { KNOWN_MODELS } from "./providers/known-models.js";

// Sessions
export { SessionStore, sessionSchema } from "./session/storage/session-store.js";
export type { SessionMeta } from "./session/storage/session-store.js";
export { HistoryManager } from "./session/history/history-manager.js";
export { Memory } from "./session/memory/memory.js";
export { SqliteStore } from "./session/storage/sqlite-store.js";

// UI
export { runAsk } from "./ui/screens/ask.js";
export type { AskOptions } from "./ui/screens/ask.js";
export { ChatController } from "./ui/screens/chat-controller.js";
export type { ChatView } from "./ui/screens/chat-controller.js";
export { THEMES, getTheme, effectiveTheme } from "./ui/themes/theme.js";
export type { Theme } from "./ui/themes/theme.js";
export { renderBanner, renderTable, Spinner } from "./ui/components/primitives.js";
export { promptHidden, promptText, promptConfirm, promptSelect } from "./ui/components/prompt.js";

// Logging
export { Logger } from "./logger/index.js";
export { FileLogger } from "./logger/file/file-logger.js";
export { ConsoleLogger } from "./logger/console/console-logger.js";

// Utils
export { paths, coderHome, ensureCoderDirs } from "./utils/paths.js";
export { SseDecoder, parseSse } from "./utils/sse.js";
export { estimateTokens, humanBytes, renderTable as _renderTable } from "./utils/format.js";

// Types
export type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  Model,
  ProviderAccount,
  Session,
  AppSettings,
  AskResult,
  Usage,
  MessageRole,
} from "./types/index.js";
