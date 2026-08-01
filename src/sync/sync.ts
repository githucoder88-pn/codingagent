/**
 * CODER — sync engine (Phase 2).
 *
 * Pushes local records (prompts/responses/feedback) to the backend control
 * plane. Designed for flaky connections:
 *   - idempotent (clientRecordId dedupes on the backend),
 *   - never fails the originating command (best-effort, retried by
 *     `coder sync` and the next ask/chat),
 *   - privacy-aware (nothing is uploaded when history is disabled).
 */

import { fingerprint } from "../../shared/src/index.js";
import { ApiClient } from "../account/api-client.js";
import { loadSession } from "../account/session-store.js";
import { loadSettings } from "../account/settings.js";
import { loadRecords, updateRecord, type LocalRecord } from "../account/records.js";
import { vault } from "../account/vault.js";
import type { AppContext } from "../core/application/application.js";

export interface SyncResult {
  pushed: number;
  failed: number;
  skipped?: string;
  feedbackUploaded: number;
}

export function syncEnabled(): boolean {
  return loadSession() !== undefined;
}

/**
 * Push unsynced records to the backend. Returns per-run counts; errors are
 * reported (for `coder sync`) but never thrown for best-effort callers.
 */
export async function syncRecords(ctx: AppContext, opts?: { silent?: boolean }): Promise<SyncResult> {
  const session = loadSession();
  const log = (msg: string) => {
    if (!opts?.silent) ctx.logger.info(msg);
  };
  if (!session) return { pushed: 0, failed: 0, skipped: "not signed in", feedbackUploaded: 0 };
  if (!loadSettings().historyEnabled) {
    return { pushed: 0, failed: 0, skipped: "history recording is disabled", feedbackUploaded: 0 };
  }

  const client = ApiClient.fromSession();
  const records = loadRecords().filter((r) => !r.syncedAt);
  let pushed = 0;
  let failed = 0;
  let feedbackUploaded = 0;

  for (const record of records) {
    try {
      await pushRecord(client, record, log);
      pushed += 1;
    } catch (err) {
      failed += 1;
      ctx.logger.warn(`Sync failed for record ${record.id}: ${(err as Error).message}`);
    }
  }

  // Feedback-only uploads (records without a prompt, or whose prompt is
  // already remote) are handled inside pushRecord; feedback attached to a
  // record whose prompt is not yet remote is uploaded right after the
  // prompt is pushed.
  return { pushed, failed, feedbackUploaded };
}

async function pushRecord(client: ApiClient, record: LocalRecord, log: (msg: string) => void): Promise<void> {
  // 1. Push the prompt (+ response) when present and not yet remote.
  let remotePromptId = record.remotePromptId;
  if (record.prompt !== undefined) {
    if (!remotePromptId) {
      const result = await client.post<{
        recorded: boolean;
        promptId?: string;
        reason?: string;
      }>("/chat/prompt", {
        clientRecordId: record.id,
        sessionId: record.sessionId,
        provider: record.provider,
        model: record.model,
        prompt: record.prompt,
        response: record.response,
        tokensUsed: record.tokensUsed,
        latencyMs: record.latencyMs,
        forTraining: record.forTraining ?? false,
      });
      if (result.body.recorded && result.body.promptId) {
        remotePromptId = result.body.promptId;
      } else if (result.body.reason === "history_disabled") {
        // Privacy changed server-side; stop trying.
        updateRecord(record.id, { syncedAt: new Date().toISOString() });
        return;
      }
    }
  }

  // 2. Push feedback when present (promptId optional on the backend).
  if (record.feedback) {
    try {
      await client.post("/chat/feedback", {
        promptId: remotePromptId,
        rating: record.feedback.rating,
        comment: record.feedback.comment,
      });
    } catch {
      // Feedback upload is best-effort; the record stays unsynced so the
      // next run retries.
      throw new Error("feedback upload failed");
    }
  }

  updateRecord(record.id, {
    remotePromptId,
    syncedAt: new Date().toISOString(),
  });
  log(`Synced ${record.id}`);
}

/**
 * Upload one record immediately after a turn completes (best-effort).
 * Never throws — the record simply remains unsynced for later retries.
 */
export async function syncOneRecord(recordId: string, ctx: AppContext): Promise<void> {
  try {
    await syncRecords(ctx, { silent: true });
  } catch {
    /* best effort */
  }
  void recordId;
}

/**
 * Sync a provider key to the backend (encrypted server-side). Returns the
 * remote fingerprint on success, undefined on failure (offline-tolerant).
 */
export async function syncProviderKey(ctx: AppContext, provider: string): Promise<string | undefined> {
  const session = loadSession();
  if (!session) return undefined;
  const account = vault().getAccount(provider);
  if (!account) return undefined;
  try {
    const client = ApiClient.fromSession();
    const result = await client.post<{ fingerprint: string }>("/auth/provider-key", {
      provider,
      apiKey: account.apiKey,
    });
    const remoteFingerprint = result.body.fingerprint;
    const localFingerprint = fingerprint(account.apiKey).slice(0, 16);
    // Sanity: the server stores the same key we sent.
    if (remoteFingerprint !== localFingerprint) {
      ctx.logger.warn(`Fingerprint mismatch for ${provider} (local ${localFingerprint} vs remote ${remoteFingerprint}).`);
    }
    vault().setAccount(provider, { ...account, remoteFingerprint, syncedAt: new Date().toISOString() });
    return remoteFingerprint;
  } catch (err) {
    ctx.logger.warn(`Could not sync ${provider} key to backend: ${(err as Error).message}`);
    return undefined;
  }
}
