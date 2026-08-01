/**
 * CODER — `coder export`.
 *
 * Exports the user's data as JSON. Local records by default; when signed
 * in, the backend bundle (prompts, responses, feedback, settings, key
 * fingerprints — never plaintext keys) is merged in. Writes
 * coder-export-<date>.json into the current directory (or --out).
 */

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadRecords } from "../../account/records.js";
import { loadSettings } from "../../account/settings.js";
import { loadSession } from "../../account/session-store.js";
import { ApiClient } from "../../account/api-client.js";
import { vault } from "../../account/vault.js";
import { fingerprint } from "../../../shared/src/index.js";
import type { AppContext } from "../../core/application/application.js";
import type { ExportBundle } from "../../../shared/src/index.js";

export interface ExportOptions {
  out?: string;
  localOnly?: boolean;
}

export async function exportCommand(ctx: AppContext, opts: ExportOptions = {}): Promise<number> {
  const { theme, logger } = ctx;
  const records = loadRecords();
  const settings = loadSettings();
  const session = loadSession();

  const localKeys = vault().list().map(({ provider, account }) => ({
    provider,
    fingerprint: fingerprint(account.apiKey).slice(0, 16),
    configuredAt: account.configuredAt,
    syncedAt: account.syncedAt,
  }));

  let remote: ExportBundle | undefined;
  if (session && !opts.localOnly) {
    try {
      const result = await ApiClient.fromSession().post<ExportBundle>("/export");
      remote = result.body;
    } catch (err) {
      process.stdout.write(`${theme.warning}Backend export failed (${(err as Error).message}); exporting local data only.${theme.reset}\n`);
    }
  }

  const bundle = {
    exportedAt: new Date().toISOString(),
    app: "coder",
    version: "0.2.0",
    account: session
      ? { email: session.user.email, role: session.user.role, serverUrl: session.serverUrl }
      : null,
    settings,
    providerKeys: remote?.providerKeys ?? localKeys,
    records,
    remoteHistory: remote
      ? {
          prompts: remote.prompts,
          responses: remote.responses,
          feedback: remote.feedback,
        }
      : undefined,
  };

  const outFile = resolve(opts.out ?? join(process.cwd(), `coder-export-${new Date().toISOString().slice(0, 10)}.json`));
  writeFileSync(outFile, `${JSON.stringify(bundle, null, 2)}\n`);
  logger.info(`Exported ${records.length} local records to ${outFile}`);
  process.stdout.write(
    `${theme.success}Exported${remote ? " (local + backend)" : " (local)"} to ${outFile}${theme.reset}\n` +
      `${theme.dim}Note: provider API keys are never exported in plaintext — only fingerprints.${theme.reset}\n`,
  );
  return 0;
}
