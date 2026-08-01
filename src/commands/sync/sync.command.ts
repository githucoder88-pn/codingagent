/**
 * CODER — `coder sync`.
 *
 * Manually push local records and provider keys to the backend control
 * plane. Also used by `coder admin sync` (same engine, admin convenience).
 */

import { syncRecords } from "../../sync/sync.js";
import { vault } from "../../account/vault.js";
import { loadSession } from "../../account/session-store.js";
import { loadSettings, saveSettings } from "../../account/settings.js";
import { ApiClient } from "../../account/api-client.js";
import type { AppContext } from "../../core/application/application.js";

export async function syncCommand(ctx: AppContext): Promise<number> {
  const { theme } = ctx;
  if (!loadSession()) {
    process.stdout.write(`${theme.dim}Not signed in — nothing to sync. Run \`coder login\` first.${theme.reset}\n`);
    return 0;
  }
  process.stdout.write(`${theme.dim}Syncing records to the backend…${theme.reset}\n`);

  // Two-way privacy sync: pull the account's server-side settings first so
  // the recording gate below matches the backend, then push local changes.
  let remoteSettings: { historyEnabled: boolean; trainingOptIn: boolean } | undefined;
  try {
    const me = await ApiClient.fromSession().get<{ settings: { historyEnabled: boolean; trainingOptIn: boolean } }>("/users/me");
    remoteSettings = me.body.settings;
  } catch {
    /* offline — use the local copy */
  }
  if (remoteSettings) {
    const local = loadSettings();
    if (
      local.historyEnabled !== remoteSettings.historyEnabled ||
      local.trainingOptIn !== remoteSettings.trainingOptIn
    ) {
      // The server wins for history (it is the enforcement point); local
      // training opt-in wins only when the server has no opinion (newer).
      saveSettings({
        historyEnabled: remoteSettings.historyEnabled,
        trainingOptIn: remoteSettings.trainingOptIn,
      });
      ctx.logger.info("Pulled privacy settings from the backend");
    }
  }
  const result = await syncRecords(ctx);

  // Also sync provider keys (encrypted server-side).
  let keysSynced = 0;
  for (const { provider, account } of vault().list()) {
    if (account.syncedAt) continue;
    const { syncProviderKey } = await import("../../sync/sync.js");
    const fingerprint = await syncProviderKey(ctx, provider);
    if (fingerprint) keysSynced += 1;
  }

  if (result.skipped) {
    process.stdout.write(`${theme.warning}Sync skipped: ${result.skipped}.${theme.reset}\n`);
    return 0;
  }
  process.stdout.write(
    `${theme.success}Sync complete: ${result.pushed} record(s) pushed, ${keysSynced} key(s) synced, ${result.failed} failed.${theme.reset}\n`,
  );
  return 0;
}
