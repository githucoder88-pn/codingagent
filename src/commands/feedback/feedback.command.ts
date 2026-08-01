/**
 * CODER — `coder feedback <rating> [comment]`.
 *
 * Attaches a rating (1-5) and optional comment to the most recent
 * conversation record. Stored locally and uploaded to the backend when
 * signed in (even with history recording off — feedback-only mode: the
 * rating is saved without the prompt text).
 */

import { appendRecord, latestRecord, updateRecord } from "../../account/records.js";
import { ApiClient } from "../../account/api-client.js";
import { loadSession } from "../../account/session-store.js";
import { UsageError } from "../../core/errors/index.js";
import type { AppContext } from "../../core/application/application.js";

export interface FeedbackOptions {
  rating: number;
  comment?: string;
}

export async function feedbackCommand(ctx: AppContext, opts: FeedbackOptions): Promise<number> {
  const { theme, logger } = ctx;
  let record = latestRecord();
  if (!record) {
    // Feedback-only mode: no conversation record exists (e.g. history is
    // disabled) — anchor the rating to the current session without the
    // prompt text.
    const sessionId = ctx.history.currentId();
    if (!sessionId) {
      throw new UsageError('No conversation yet. Run `coder ask "…"` or `coder chat` first, then rate the result.');
    }
    record = appendRecord({
      sessionId,
      provider: ctx.settings().provider,
      model: ctx.settings().model ?? "unknown",
    });
    ctx.logger.info(`Created feedback-only record ${record.id} (history disabled)`);
  }

  const updated = updateRecord(record.id, {
    feedback: {
      rating: opts.rating,
      ...(opts.comment ? { comment: opts.comment } : {}),
      createdAt: new Date().toISOString(),
    },
  });

  process.stdout.write(
    `${theme.success}Feedback recorded (${opts.rating}/5${opts.comment ? ` — ${opts.comment}` : ""}) for ${record.id}.${theme.reset}\n`,
  );

  // Upload to the backend (best-effort; the sync engine retries later).
  if (loadSession() && updated) {
    try {
      const client = ApiClient.fromSession();
      // Ensure the record's prompt exists remotely first.
      let promptId = updated.remotePromptId;
      if (!promptId && updated.prompt) {
        const pushed = await client.post<{ promptId?: string; recorded?: boolean }>("/chat/prompt", {
          clientRecordId: updated.id,
          sessionId: updated.sessionId,
          provider: updated.provider,
          model: updated.model,
          prompt: updated.prompt,
          response: updated.response,
          forTraining: updated.forTraining ?? false,
        });
        promptId = pushed.body.promptId;
        updateRecord(updated.id, { remotePromptId: promptId, syncedAt: new Date().toISOString() });
      }
      await client.post("/chat/feedback", {
        promptId,
        rating: opts.rating,
        comment: opts.comment,
      });
      process.stdout.write(`${theme.success}Feedback synced to the backend.${theme.reset}\n`);
    } catch (err) {
      process.stdout.write(
        `${theme.warning}Feedback saved locally; backend upload pending (${(err as Error).message}). Run \`coder sync\` later.${theme.reset}\n`,
      );
    }
  }
  logger.info(`Feedback ${opts.rating}/5 for ${record.id}`);
  return 0;
}
