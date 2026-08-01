/**
 * CODER — configuration manager.
 *
 * Owns `~/.coder/config.json` and the encrypted provider-key vault
 * (`~/.coder/vault.json`, see src/account/vault.ts):
 *   - load/validate/save config with zod,
 *   - merge environment overrides (CODER_PROVIDER, CODER_MODEL, …),
 *   - read/write provider API keys (encrypted at rest, 0600 permissions),
 *   - atomic writes so a crash never corrupts the files.
 */

import { ConfigError, AuthError } from "../../core/errors/index.js";
import { paths, readJson, writeJson } from "../../utils/paths.js";
import { configSchema, providersSchema, type ConfigFile } from "../schema/schema.js";
import { CONFIG_DEFAULTS, ENV } from "../defaults/index.js";
import { parseBoolEnv } from "../../utils/format.js";
import { type AppSettings, type ProviderAccount } from "../../types/index.js";
import { vault } from "../../account/vault.js";

export class ConfigManager {
  private config: ConfigFile;

  constructor() {
    this.config = this.loadConfig();
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
  // Provider keys live in the encrypted vault (Phase 2). The legacy
  // providers.json schema is kept only for backward-compatible reads of
  // migrated files; nothing is written in plain text anymore.

  /** Save an API key (and optional base URL override) for a provider. */
  setApiKey(provider: string, apiKey: string, baseUrl?: string): void {
    vault().setAccount(provider, {
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
      configuredAt: new Date().toISOString(),
    });
  }

  getAccount(provider: string): ProviderAccount | undefined {
    return vault().getAccount(provider);
  }

  getApiKey(provider: string): string {
    const account = vault().getAccount(provider);
    if (!account) {
      throw new AuthError(`No API key stored for provider "${provider}". Run: coder auth add ${provider}`);
    }
    return account.apiKey;
  }

  removeApiKey(provider: string): boolean {
    return vault().remove(provider);
  }

  listAccounts(): Array<{ provider: string; account: ProviderAccount }> {
    return vault().list();
  }

  /** Force-reload the config file from disk. */
  reload(): void {
    this.config = this.loadConfig();
  }
}

