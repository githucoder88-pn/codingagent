/**
 * CODER — configuration manager.
 *
 * Owns `~/.coder/config.json` and `~/.coder/providers.json`:
 *   - load/validate/save config with zod,
 *   - merge environment overrides (CODER_PROVIDER, CODER_MODEL, …),
 *   - read/write provider API keys (0600 file permissions),
 *   - atomic writes so a crash never corrupts the files.
 */

import { ConfigError, AuthError } from "../../core/errors/index.js";
import { paths, readJson, writeJson, atomicWriteFile } from "../../utils/paths.js";
import { configSchema, providersSchema, type ConfigFile, type ProvidersFile } from "../schema/schema.js";
import { CONFIG_DEFAULTS, ENV } from "../defaults/index.js";
import { parseBoolEnv } from "../../utils/format.js";
import { type AppSettings, type ProviderAccount } from "../../types/index.js";

export class ConfigManager {
  private config: ConfigFile;
  private providers: ProvidersFile;

  constructor() {
    this.config = this.loadConfig();
    this.providers = this.loadProviders();
  }

  // ------------------------------------------------------------------ config

  private loadConfig(): ConfigFile {
    const raw = readJson<unknown>(paths.config());
    if (raw === undefined) return { ...CONFIG_DEFAULTS };
    const parsed = configSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.length ? ` at "${issue.path.join(".")}"` : "";
      throw new ConfigError(
        `Invalid configuration in ${paths.config()}: ${issue?.message ?? "unknown error"}${where}`,
      );
    }
    return parsed.data;
  }

  /** Settings with environment overrides applied (read at call time). */
  settings(): AppSettings {
    const streamEnv = parseBoolEnv(process.env[ENV.stream]);
    return {
      provider: process.env[ENV.provider]?.trim() || this.config.provider,
      model: process.env[ENV.model]?.trim() || this.config.model,
      theme: process.env[ENV.theme]?.trim() || this.config.theme,
      stream: streamEnv ?? this.config.stream,
    };
  }

  get<K extends keyof ConfigFile>(key: K): ConfigFile[K] {
    return this.config[key];
  }

  set<K extends keyof ConfigFile>(key: K, value: ConfigFile[K]): void {
    const next = { ...this.config, [key]: value };
    const parsed = configSchema.safeParse(next);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ConfigError(`Invalid value for "${key}": ${issue?.message ?? "unknown error"}`);
    }
    this.config = parsed.data;
    writeJson(paths.config(), this.config);
  }

  /** The raw config file as a plain object (for `config show`). */
  all(): ConfigFile {
    return { ...this.config };
  }

  path(): string {
    return paths.config();
  }

  // --------------------------------------------------------------- providers

  private loadProviders(): ProvidersFile {
    const raw = readJson<unknown>(paths.providers());
    if (raw === undefined) return {};
    const parsed = providersSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConfigError(`Invalid providers file ${paths.providers()}: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
    }
    return parsed.data;
  }

  private saveProviders(): void {
    writeJson(paths.providers(), this.providers, { mode: 0o600 });
  }

  /** Save an API key (and optional base URL override) for a provider. */
  setApiKey(provider: string, apiKey: string, baseUrl?: string): void {
    const account: ProviderAccount = {
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
      configuredAt: new Date().toISOString(),
    };
    this.providers[provider] = account;
    this.saveProviders();
  }

  getAccount(provider: string): ProviderAccount | undefined {
    return this.providers[provider];
  }

  getApiKey(provider: string): string {
    const account = this.getAccount(provider);
    if (!account) {
      throw new AuthError(`No API key stored for provider "${provider}". Run: coder auth ${provider}`);
    }
    return account.apiKey;
  }

  removeApiKey(provider: string): boolean {
    if (!(provider in this.providers)) return false;
    delete this.providers[provider];
    this.saveProviders();
    return true;
  }

  listAccounts(): Array<{ provider: string; account: ProviderAccount }> {
    return Object.entries(this.providers).map(([provider, account]) => ({ provider, account }));
  }

  /** Force-reload both files from disk (used after external edits in chat). */
  reload(): void {
    this.config = this.loadConfig();
    this.providers = this.loadProviders();
  }
}
