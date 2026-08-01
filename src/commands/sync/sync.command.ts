/**
 * CODER — `coder sync`.
 *
 * Manually push local records and provider keys to the backend control
 * plane. Also used by `coder admin sync` (same engine, admin convenience).
 */

import { syncRecords } from "../../sync/sync.js";
import { vault } from "../../account/vault.js";
import { loadSession } from "../../account/session-store.js";
import type { AppContext } from "../../core/application/application.js";

export async function syncCommand(ctx: AppContext): Promise<number> {
  const { theme } = ctx;
  if (!loadSession()) {
    process.stdout.write(`${theme.dim}Not signed in — nothing to sync. Run \`coder login\` first.${theme.reset}\n`);
    return 0;
  }
  process.stdout.write(`${theme.dim}Syncing records to the backend…${theme.reset}\n`);
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
