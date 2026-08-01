/**
 * CODER CLI — turn recorder.
 *
 * After every successful ask/chat turn, records the prompt + response into
 * the local records store (privacy-gated) and triggers a best-effort sync
 * to the backend. Never throws — recording must not break a chat turn.
 */

import { loadSettings } from "./settings.js";
import { appendRecord, updateRecord } from "./records.js";
import { syncRecords } from "../sync/sync.js";
import { estimateTokens } from "../utils/format.js";
import type { AppContext } from "../core/application/application.js";

export interface TurnInfo {
  sessionId: string;
  provider: string;
  model: string;
  prompt: string;
  response: string;
  tokensUsed?: number;
  latencyMs?: number;
}

/** Record a completed turn locally and push it to the backend. */
export async function recordTurn(ctx: AppContext, info: TurnInfo): Promise<{ recorded: boolean; recordId?: string }> {
  const settings = loadSettings();
  if (!settings.historyEnabled) return { recorded: false };

  try {
    const record = appendRecord({
      sessionId: info.sessionId,
      provider: info.provider,
      model: info.model,
      prompt: info.prompt,
      response: info.response,
      tokensUsed: info.tokensUsed ?? estimateTokens(info.response),
      latencyMs: info.latencyMs,
      forTraining: settings.trainingOptIn,
    });
    // Best-effort push; failures keep the record unsynced for `coder sync`.
    try {
      await syncRecords(ctx, { silent: true });
    } catch {
      /* offline — record stays local */
    }
    return { recorded: true, recordId: record.id };
  } catch (err) {
    ctx.logger.warn(`Could not record turn: ${(err as Error).message}`);
    return { recorded: false };
  }
}

/** Mark a record's feedback locally (used by the feedback command). */
export function attachFeedback(recordId: string, rating: number, comment?: string): boolean {
  return (
    updateRecord(recordId, {
      feedback: {
        rating,
        ...(comment ? { comment } : {}),
        createdAt: new Date().toISOString(),
      },
    }) !== undefined
  );
}
