/**
 * CODER — `coder history`.
 *
 * Local history (records store) by default; `--remote` reads the backend
 * history (requires sign-in and history recording enabled).
 */

import { loadRecords } from "../../account/records.js";
import { ApiClient } from "../../account/api-client.js";
import { loadSession } from "../../account/session-store.js";
import { renderTable } from "../../ui/components/primitives.js";
import { truncate } from "../../utils/format.js";
import { UsageError } from "../../core/errors/index.js";
import type { AppContext } from "../../core/application/application.js";
import type { HistoryItem } from "../../../shared/src/index.js";

export interface HistoryOptions {
  remote?: boolean;
  limit: number;
  json?: boolean;
}

export async function historyCommand(ctx: AppContext, opts: HistoryOptions): Promise<number> {
  const { theme } = ctx;

  if (opts.remote) {
    return remoteHistory(ctx, opts);
  }

  const records = loadRecords()
    .filter((r) => r.prompt !== undefined)
    .slice(-opts.limit)
    .reverse();

  if (records.length === 0) {
    process.stdout.write(`${theme.dim}No recorded prompts yet. Run \`coder ask "…"\` and history will be saved here.${theme.reset}\n`);
    return 0;
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
    return 0;
  }

  const rows = records.map((r) => [
    r.createdAt.slice(0, 19).replace("T", " "),
    r.model,
    truncate(r.prompt ?? "", 60),
    r.feedback ? `${r.feedback.rating}/5` : "—",
    r.syncedAt ? "synced" : "local",
  ]);
  process.stdout.write(`${renderTable(["WHEN", "MODEL", "PROMPT", "RATING", "STATUS"], rows)}\n`);
  process.stdout.write(`${theme.dim}Total: ${loadRecords().length} records · use --remote for backend history · --json for raw output${theme.reset}\n`);
  return 0;
}

async function remoteHistory(ctx: AppContext, opts: HistoryOptions): Promise<number> {
  const { theme } = ctx;
  if (!loadSession()) {
    throw new UsageError("Not signed in. Run `coder login` first, or use local history (no --remote).");
  }
  const client = ApiClient.fromSession();
  const result = await client.get<{ records: HistoryItem[]; disabled?: boolean; total?: number }>(
    `/chat/history?limit=${opts.limit}&offset=0`,
  );
  if (result.body.disabled) {
    process.stdout.write(`${theme.dim}Backend history recording is disabled for this account. Enable it with \`coder settings history on\`.${theme.reset}\n`);
    return 0;
  }
  const items = result.body.records;
  if (items.length === 0) {
    process.stdout.write(`${theme.dim}No backend history yet.${theme.reset}\n`);
    return 0;
  }
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(items, null, 2)}\n`);
    return 0;
  }
  const rows = items.map((item) => [
    item.createdAt.slice(0, 19).replace("T", " "),
    item.model,
    truncate(item.prompt, 60),
    item.rating ? `${item.rating}/5` : "—",
  ]);
  process.stdout.write(`${renderTable(["WHEN", "MODEL", "PROMPT", "RATING"], rows)}\n`);
  return 0;
}
