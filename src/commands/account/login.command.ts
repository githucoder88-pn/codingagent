/**
 * CODER — `coder login`, `coder logout`, `coder delete-account`.
 *
 * Account management against the Phase 2 control plane. The session token
 * is stored in ~/.coder/session.json (0600); provider keys keep living in
 * the encrypted local vault and are mirrored to the backend.
 */

import { ApiClient, resolveServerUrl } from "../../account/api-client.js";
import { clearSession, loadSession, requireSession, saveSession } from "../../account/session-store.js";
import { promptHidden, promptText, promptConfirm } from "../../ui/components/prompt.js";
import { AuthError, UsageError } from "../../core/errors/index.js";
import { fingerprint } from "../../../shared/src/index.js";
import { vault } from "../../account/vault.js";
import { loadSettings, saveSettings } from "../../account/settings.js";
import { loadRecords, saveRecords } from "../../account/records.js";
import { paths } from "../../utils/paths.js";
import { rmSync } from "node:fs";
import type { AppContext } from "../../core/application/application.js";
import type { AuthResponse } from "../../../shared/src/index.js";

export interface LoginOptions {
  email?: string;
  password?: string;
  serverUrl?: string;
}

export async function loginCommand(ctx: AppContext, opts: LoginOptions = {}): Promise<number> {
  const { theme, logger } = ctx;
  const serverUrl = opts.serverUrl ?? resolveServerUrl();

  const email = opts.email ?? (await promptText(`${theme.accent}Email${theme.reset}: `));
  if (!email || email.trim() === "") throw new UsageError("Email is required (or pass --email).");
  const password = opts.password ?? (await promptHidden(`${theme.accent}Password${theme.reset} (hidden): `));
  if (!password) throw new UsageError("Password is required (or pass --password).");

  const client = ApiClient.at(serverUrl);
  let result: AuthResponse;
  try {
    result = (await client.post<AuthResponse>("/auth/login", { email, password })).body;
  } catch (err) {
    if ((err as Error).message.includes("Cannot reach")) {
      throw new AuthError(
        `${(err as Error).message}\nStart the backend with \`coder server start\` and retry.`,
      );
    }
    throw err;
  }

  saveSession({
    token: result.token,
    user: { id: result.user.id, email: result.user.email, role: result.user.role },
    serverUrl,
    loggedInAt: new Date().toISOString(),
  });
  logger.info(`Signed in as ${result.user.email} (${result.user.role}) at ${serverUrl}`);

  process.stdout.write(
    `${theme.success}Signed in as ${result.user.email} (${result.user.role}).${theme.reset}\n`,
  );
  process.stdout.write(
    `${theme.dim}Sync provider keys: \`coder auth add <provider>\` · Privacy: \`coder settings privacy on\`${theme.reset}\n`,
  );

  // Best-effort: sync unsynced vault keys so the dashboard sees them.
  // (Keys already synced by another account stay put — they belong to
  // whichever account uploaded them.)
  for (const { provider, account } of vault().list()) {
    if (account.syncedAt) continue;
    const { syncProviderKey } = await import("../../sync/sync.js");
    await syncProviderKey(ctx, provider);
  }
  return 0;
}

/** `coder signup` — create an account (then signs in). */
export async function signupCommand(ctx: AppContext, opts: LoginOptions = {}): Promise<number> {
  const { theme, logger } = ctx;
  const serverUrl = opts.serverUrl ?? resolveServerUrl();

  const email = opts.email ?? (await promptText(`${theme.accent}Email${theme.reset}: `));
  if (!email || email.trim() === "") throw new UsageError("Email is required (or pass --email).");
  const password = opts.password ?? (await promptHidden(`${theme.accent}Password${theme.reset} (min 8 chars, hidden): `));
  if (!password || password.length < 8) {
    throw new UsageError("Password must be at least 8 characters (or pass --password).");
  }

  const client = ApiClient.at(serverUrl);
  let result: AuthResponse;
  try {
    result = (await client.post<AuthResponse>("/auth/signup", { email, password })).body;
  } catch (err) {
    if ((err as Error).message.includes("Cannot reach")) {
      throw new AuthError(`${(err as Error).message}\nStart the backend with \`coder server start\` and retry.`);
    }
    throw err;
  }
  saveSession({
    token: result.token,
    user: { id: result.user.id, email: result.user.email, role: result.user.role },
    serverUrl,
    loggedInAt: new Date().toISOString(),
  });
  logger.info(`Signed up as ${result.user.email}`);
  process.stdout.write(`${theme.success}Account created. Signed in as ${result.user.email}.${theme.reset}\n`);
  return 0;
}

export async function logoutCommand(ctx: AppContext): Promise<number> {
  const { theme, logger } = ctx;
  const session = loadSession();
  if (session) {
    try {
      await ApiClient.fromSession().post("/auth/logout");
    } catch {
      /* best effort — the local session is cleared regardless */
    }
  }
  clearSession();
  logger.info("Signed out");
  process.stdout.write(`${theme.success}Signed out.${theme.reset}\n`);
  return 0;
}

export interface DeleteAccountOptions {
  yes?: boolean;
  wipeLocal?: boolean;
}

export async function deleteAccountCommand(ctx: AppContext, opts: DeleteAccountOptions = {}): Promise<number> {
  const { theme, logger } = ctx;
  const session = requireSession();

  if (!opts.yes) {
    const confirmed = await promptConfirm(
      `This permanently deletes your CODER account and all backend data ` +
        `(prompts, responses, feedback, keys) for ${session.user.email}. Continue?`,
      false,
    );
    if (confirmed !== true) {
      process.stdout.write(`${theme.dim}Aborted.${theme.reset}\n`);
      return 0;
    }
  }

  const client = ApiClient.fromSession();
  try {
    const result = await client.post<{ deleted: boolean; stats: { promptCount: number } }>("/delete-account");
    process.stdout.write(
      `${theme.success}Account deleted from the backend${result.body.stats.promptCount > 0 ? ` (${result.body.stats.promptCount} prompts erased)` : ""}.${theme.reset}\n`,
    );
  } catch (err) {
    process.stdout.write(`${theme.warning}Backend deletion failed: ${(err as Error).message}${theme.reset}\n`);
    if (!opts.yes) {
      const proceed = await promptConfirm("Delete local account data anyway?", false);
      if (proceed !== true) return 0;
    }
  }

  // Local cleanup: session, records, settings, vault (encrypted keys).
  clearSession();
  vault().wipe();
  try {
    rmSync(paths.records(), { force: true });
    rmSync(paths.settings(), { force: true });
  } catch {
    /* best effort */
  }
  if (opts.wipeLocal) {
    try {
      rmSync(paths.sessionsDir(), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  logger.info(`Deleted account data for ${session.user.email}`);
  process.stdout.write(`${theme.success}Local account data cleared.${theme.reset}\n`);
  return 0;
}

/** Utility for other commands: keep local privacy settings in sync with the backend. */
export async function pullRemoteSettings(ctx: AppContext): Promise<void> {
  const session = loadSession();
  if (!session) return;
  try {
    const result = await ApiClient.fromSession().get<{
      settings: { historyEnabled: boolean; trainingOptIn: boolean };
    }>("/users/me");
    saveSettings(result.body.settings);
  } catch {
    /* offline — keep local copy */
  }
  void ctx;
}

/** Utility: upload local privacy settings to the backend (best-effort). */
export async function pushSettingsToBackend(settings: { historyEnabled: boolean; trainingOptIn: boolean }): Promise<boolean> {
  if (!loadSession()) return false;
  try {
    await ApiClient.fromSession().patch("/users/me/settings", settings);
    return true;
  } catch {
    return false;
  }
}

export { fingerprint };
export { loadSettings };
