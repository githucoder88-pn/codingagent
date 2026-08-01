/**
 * CODER — `coder auth` commands (Phase 2).
 *
 * `coder auth add <provider>` stores the key in the encrypted local vault
 * AND (when signed in) on the backend, where it is encrypted at rest with
 * the server master key. `list` / `status` show local + sync state;
 * `remove` deletes both copies.
 */

import { type AppContext } from "../../core/application/application.js";
import { AuthError, UsageError } from "../../core/errors/index.js";
import { promptHidden } from "../../ui/components/prompt.js";
import { renderTable } from "../../ui/components/primitives.js";
import { type Provider } from "../../providers/base/provider.interface.js";
import { type ProviderAccount } from "../../types/index.js";
import { vault } from "../../account/vault.js";
import { loadSession } from "../../account/session-store.js";
import { ApiClient } from "../../account/api-client.js";

export interface AuthAddOptions {
  providerId: string;
  key?: string;
  baseUrl?: string;
  /** Skip the backend upload (offline installs). */
  noUpload?: boolean;
}

function maskKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

const KEY_PREFIX_HINTS: Record<string, string> = {
  openai: "sk-",
  anthropic: "sk-ant-",
  gemini: "AIza",
  openrouter: "sk-or-",
};

/** Validate a provider key format locally (mirrors backend validation). */
export function validateKeyFormat(provider: string, key: string): string | null {
  if (key.length < 8) return "API key must be at least 8 characters long.";
  const hint = KEY_PREFIX_HINTS[provider];
  if (hint && !key.startsWith(hint)) {
    return `Keys for "${provider}" usually start with "${hint}". Double-check the key.`;
  }
  return null;
}

export async function authAddCommand(ctx: AppContext, opts: AuthAddOptions): Promise<number> {
  const { registry, config, theme, logger } = ctx;
  const provider = registry.get(opts.providerId);

  if (!provider.requiresKey) {
    process.stdout.write(
      `${theme.success}Provider "${provider.name}" does not require an API key.${theme.reset}\n`,
    );
    return 0;
  }

  let key = opts.key;
  if (!key) {
    const answer = await promptHidden(`Enter API key for ${provider.name}${theme.dim} (input hidden)${theme.reset}: `);
    if (answer === null || answer.trim() === "") {
      throw new UsageError(
        `No API key provided. Use the interactive prompt or pass --key (e.g. \`coder auth add ${provider.id} --key sk-...\`).`,
      );
    }
    key = answer.trim();
  }

  const formatIssue = validateKeyFormat(provider.id, key);
  if (formatIssue) {
    process.stdout.write(`${theme.warning}${formatIssue}${theme.reset}\n`);
  }

  // Local encrypted storage (Phase 2 vault).
  config.setApiKey(provider.id, key, opts.baseUrl);
  logger.info(`Stored API key for provider "${provider.id}" (encrypted vault)`);

  // Verify against the provider (network permitting).
  const valid = await provider.authenticate(key);
  if (valid) {
    process.stdout.write(
      `${theme.success}API key for ${provider.name} stored encrypted and verified.${theme.reset}\n`,
    );
  } else {
    process.stdout.write(
      `${theme.warning}API key stored, but verification failed (check the key or your network).${theme.reset}\n`,
    );
  }

  // Upload to the backend (encrypted at rest there too).
  if (!opts.noUpload && loadSession()) {
    const { syncProviderKey } = await import("../../sync/sync.js");
    const remoteFingerprint = await syncProviderKey(ctx, provider.id);
    if (remoteFingerprint) {
      process.stdout.write(`${theme.success}Key synced to the backend (encrypted).${theme.reset}\n`);
    } else {
      process.stdout.write(
        `${theme.warning}Key stored locally; backend upload pending (offline?). Run \`coder sync\` later.${theme.reset}\n`,
      );
    }
  }
  return 0;
}

export async function authListCommand(ctx: AppContext): Promise<number> {
  const { config, registry, theme } = ctx;
  const accounts = config.listAccounts();
  if (accounts.length === 0) {
    process.stdout.write(`${theme.dim}No API keys stored yet. Run \`coder auth add <provider>\`.${theme.reset}\n`);
    return 0;
  }
  const remoteFingerprints = new Map<string, string>();
  if (loadSession()) {
    try {
      const result = await ApiClient.fromSession().get<{ keys: Array<{ provider: string; fingerprint: string }> }>("/auth/provider-keys");
      for (const key of result.body.keys) remoteFingerprints.set(key.provider, key.fingerprint);
    } catch {
      /* offline — local-only view */
    }
  }
  const rows = accounts.map(({ provider, account }) => [
    provider,
    registry.has(provider) ? registry.get(provider).name : "(unknown)",
    maskKey(account.apiKey),
    account.baseUrl ?? "default",
    account.remoteFingerprint ?? remoteFingerprints.get(provider) ?? "local only",
    account.configuredAt.slice(0, 10),
  ]);
  process.stdout.write(`${renderTable(["PROVIDER", "NAME", "KEY", "BASE URL", "BACKEND", "CONFIGURED"], rows)}\n`);
  return 0;
}

export async function authStatusCommand(ctx: AppContext): Promise<number> {
  const { config, registry, theme } = ctx;
  const active = ctx.settings().provider;
  const rows = registry.list().map((provider) => {
    const account = config.getAccount(provider.id);
    const isActive = provider.id === active ? "*" : "";
    return [
      `${provider.id}${isActive}`,
      provider.name,
      provider.requiresKey ? (account ? "configured" : "missing key") : "not required",
      account?.baseUrl ?? "default",
      account?.syncedAt ? "synced" : account ? "local only" : "—",
    ];
  });
  process.stdout.write(`${renderTable(["PROVIDER", "NAME", "STATUS", "BASE URL", "BACKEND"], rows)}\n`);
  process.stdout.write(`${theme.dim}* = active provider · add keys with \`coder auth add <provider>\`${theme.reset}\n`);
  return 0;
}

export async function authRemoveCommand(ctx: AppContext, providerId: string): Promise<number> {
  const { config, registry, theme } = ctx;
  if (!registry.has(providerId)) {
    throw new UsageError(`Unknown provider "${providerId}". Run \`coder auth status\` to list providers.`);
  }
  const removed = config.removeApiKey(providerId);
  if (removed && loadSession()) {
    try {
      await ApiClient.fromSession().delete(`/auth/provider-key/${providerId}`);
    } catch {
      /* best effort */
    }
  }
  if (!removed) {
    process.stdout.write(`${theme.dim}No API key stored for "${providerId}".${theme.reset}\n`);
    return 0;
  }
  process.stdout.write(`${theme.success}Removed API key for ${providerId} (local vault${loadSession() ? " + backend" : ""}).${theme.reset}\n`);
  return 0;
}

/** Shared provider validation used by several commands. */
export function requireConfigured(ctx: AppContext, provider: Provider): ProviderAccount {
  const account = ctx.config.getAccount(provider.id);
  if (provider.requiresKey && !account) {
    throw new AuthError(
      `Provider "${provider.id}" is not configured. Run \`coder auth add ${provider.id}\` first.`,
    );
  }
  return account!;
}

/** Backend key validation (mirror of the server's providerKeySchema). */
export function backendValidateKey(provider: string, key: string): boolean {
  return key.length >= 8 && key.length <= 1024 && ["openai", "anthropic", "gemini", "openrouter"].includes(provider);
}
