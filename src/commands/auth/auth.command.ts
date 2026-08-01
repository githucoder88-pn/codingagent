/**
 * CODER — `coder auth` commands.
 *
 * Stores API keys in ~/.coder/providers.json (0600 permissions) and
 * verifies them against the provider when possible. Keys can be supplied
 * interactively (hidden input) or via `--key` for scripts/CI.
 */

import { type AppContext } from "../../core/application/application.js";
import { AuthError, UsageError } from "../../core/errors/index.js";
import { promptHidden } from "../../ui/components/prompt.js";
import { renderTable } from "../../ui/components/primitives.js";
import { type Provider } from "../../providers/base/provider.interface.js";
import { type ProviderAccount } from "../../types/index.js";

export interface AuthOptions {
  providerId: string;
  key?: string;
  baseUrl?: string;
}

function maskKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export async function authCommand(ctx: AppContext, opts: AuthOptions): Promise<number> {
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
        `No API key provided. Use the interactive prompt or pass --key (e.g. \`coder auth ${provider.id} --key sk-...\`).`,
      );
    }
    key = answer.trim();
  }

  config.setApiKey(provider.id, key, opts.baseUrl);
  logger.info(`Stored API key for provider "${provider.id}"`);

  const valid = await provider.authenticate(key);
  if (valid) {
    process.stdout.write(
      `${theme.success}API key for ${provider.name} stored and verified.${theme.reset}\n`,
    );
  } else {
    process.stdout.write(
      `${theme.warning}API key stored, but verification failed (check the key or your network).${theme.reset}\n`,
    );
  }
  return 0;
}

export async function authListCommand(ctx: AppContext): Promise<number> {
  const { config, registry, theme } = ctx;
  const accounts = config.listAccounts();
  const rows = accounts.map(({ provider, account }) => [
    provider,
    registry.has(provider) ? registry.get(provider).name : "(unknown)",
    maskKey(account.apiKey),
    account.baseUrl ?? "default",
    account.configuredAt.slice(0, 10),
  ]);
  if (rows.length === 0) {
    process.stdout.write(`${theme.dim}No API keys stored yet. Run \`coder auth <provider>\`.${theme.reset}\n`);
    return 0;
  }
  process.stdout.write(
    `${renderTable(["PROVIDER", "NAME", "KEY", "BASE URL", "CONFIGURED"], rows)}\n`,
  );
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
    ];
  });
  process.stdout.write(
    `${renderTable(["PROVIDER", "NAME", "STATUS", "BASE URL"], rows)}\n`,
  );
  process.stdout.write(`${theme.dim}* = active provider${theme.reset}\n`);
  return 0;
}

export async function authRemoveCommand(ctx: AppContext, providerId: string): Promise<number> {
  const { config, registry, theme } = ctx;
  if (!registry.has(providerId)) {
    throw new UsageError(`Unknown provider "${providerId}". Run \`coder auth status\` to list providers.`);
  }
  const removed = config.removeApiKey(providerId);
  if (!removed) {
    process.stdout.write(`${theme.dim}No API key stored for "${providerId}".${theme.reset}\n`);
    return 0;
  }
  process.stdout.write(`${theme.success}Removed API key for ${providerId}.${theme.reset}\n`);
  return 0;
}

/** Shared provider validation used by several commands. */
export function requireConfigured(ctx: AppContext, provider: Provider): ProviderAccount {
  const account = ctx.config.getAccount(provider.id);
  if (provider.requiresKey && !account) {
    throw new AuthError(
      `Provider "${provider.id}" is not configured. Run \`coder auth ${provider.id}\` first.`,
    );
  }
  return account!;
}
