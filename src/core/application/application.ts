/**
 * CODER — application context.
 *
 * `createApp()` bootstraps the whole application: filesystem layout,
 * configuration, logger, storage, session services, provider registry and
 * the resolved UI theme. Every command receives this context; tests build
 * their own with a temp CODER_HOME.
 */

import { ConfigManager } from "../../config/manager/config-manager.js";
import { Logger } from "../../logger/index.js";
import { Memory } from "../../session/memory/memory.js";
import { HistoryManager } from "../../session/history/history-manager.js";
import { SessionStore } from "../../session/storage/session-store.js";
import { SqliteStore } from "../../session/storage/sqlite-store.js";
import { type AppSettings } from "../../types/index.js";
import { ModelCache } from "../../providers/model-cache.js";
import { HttpClient } from "../../providers/http-client.js";
import { ProviderRegistry } from "../../providers/registry.js";
import { OpenAiProvider } from "../../providers/openai/openai.provider.js";
import { AnthropicProvider } from "../../providers/anthropic/anthropic.provider.js";
import { GeminiProvider } from "../../providers/gemini/gemini.provider.js";
import { OpenRouterProvider } from "../../providers/openrouter/openrouter.provider.js";
import { MockProvider } from "../../providers/mock/mock.provider.js";
import { type Theme, effectiveTheme } from "../../ui/themes/theme.js";
import { Container } from "../container/container.js";
import { ensureCoderDirs } from "../../utils/paths.js";

/** Container tokens. */
export const TOKENS = {
  config: "config",
  store: "store",
  sessions: "sessions",
  history: "history",
  memory: "memory",
  modelCache: "modelCache",
  http: "http",
  registry: "registry",
} as const;

export interface AppContext {
  container: Container;
  config: ConfigManager;
  logger: Logger;
  store: SqliteStore;
  sessions: SessionStore;
  history: HistoryManager;
  memory: Memory;
  modelCache: ModelCache;
  registry: ProviderRegistry;
  theme: Theme;
  /** Settings with environment overrides applied (fresh on every call). */
  settings: () => AppSettings;
}

export interface CreateAppOptions {
  consoleDebug?: boolean;
  themeName?: string;
  /** Force colour on/off (default: auto-detect). */
  color?: boolean;
  /** Skip filesystem setup (tests that want a pristine layout). */
  skipSetup?: boolean;
}

export function buildContainer(): Container {
  const container = new Container();
  container.register(TOKENS.config, () => new ConfigManager());
  container.register(TOKENS.store, () => new SqliteStore());
  container.register(TOKENS.modelCache, (c) => new ModelCache(c.resolve(TOKENS.store)));
  container.register(TOKENS.sessions, () => new SessionStore());
  container.register(TOKENS.history, (c) => new HistoryManager(c.resolve(TOKENS.sessions)));
  container.register(TOKENS.memory, () => new Memory());
  container.register(TOKENS.http, () => new HttpClient());
  container.register(TOKENS.registry, (c) => {
    const registry = new ProviderRegistry(c.resolve(TOKENS.modelCache));
    const config = c.resolve<ConfigManager>(TOKENS.config);
    const http = c.resolve<HttpClient>(TOKENS.http);
    registry.register(new OpenAiProvider(config, http));
    registry.register(new AnthropicProvider(config, http));
    registry.register(new GeminiProvider(config, http));
    registry.register(new OpenRouterProvider(config, http));
    registry.register(new MockProvider());
    return registry;
  });
  return container;
}

export async function createApp(options: CreateAppOptions = {}): Promise<AppContext> {
  if (!options.skipSetup) ensureCoderDirs();

  const container = buildContainer();
  const config = container.resolve<ConfigManager>(TOKENS.config);
  const store = container.resolve<SqliteStore>(TOKENS.store);
  const sessions = container.resolve<SessionStore>(TOKENS.sessions);
  const history = container.resolve<HistoryManager>(TOKENS.history);
  const memory = container.resolve<Memory>(TOKENS.memory);
  const modelCache = container.resolve<ModelCache>(TOKENS.modelCache);
  const registry = container.resolve<ProviderRegistry>(TOKENS.registry);

  const settings = () => config.settings();
  const themeName = options.themeName ?? settings().theme;
  const theme = effectiveTheme(themeName, { enabled: options.color });

  const debugEnv = process.env.CODER_DEBUG !== undefined && process.env.CODER_DEBUG !== "0";
  const logger = new Logger({
    consoleDebug: options.consoleDebug ?? debugEnv,
    theme,
  });

  const ctx: AppContext = {
    container,
    config,
    logger,
    store,
    sessions,
    history,
    memory,
    modelCache,
    registry,
    theme,
    settings,
  };

  await registry.initializeAll();
  return ctx;
}

/** Graceful shutdown: flush logs, close the DB. */
export async function shutdownApp(ctx: AppContext): Promise<void> {
  try {
    await ctx.container.disposeAll();
  } catch {
    /* best effort */
  }
  ctx.logger.close();
}
