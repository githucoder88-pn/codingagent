/**
 * CODER backend — chat routes.
 *
 * - POST /api/chat/prompt        record a prompt (+ response) — idempotent
 *                                via clientRecordId, privacy-gated
 * - GET  /api/chat/history       user's prompt/response history
 * - POST /api/chat/feedback      attach a rating/comment to a prompt
 * - POST /api/chat/completions   server-side provider proxy (uses the
 *                                encrypted key, decrypts in memory only)
 */

import { Router } from "express";
import { chatPromptSchema, chatCompletionsSchema, feedbackSchema, historyQuerySchema } from "../../../shared/src/index.js";
import { Database } from "../database/db.js";
import {
  countPromptsForUser,
  findPromptByClientRecordId,
  findPromptById,
  getProviderKeyRow,
  getResponseForPrompt,
  historyForUser,
  insertFeedback,
  insertPrompt,
  insertResponse,
  writeAudit,
} from "../database/repos.js";
import { asyncHandler, badRequest, httpError, requireAuth, type AuthedRequest } from "../auth/middleware.js";
import type { KeyManager } from "../encryption/key-manager.js";

export interface ChatRouterDeps {
  db: Database;
  keyManager: KeyManager;
}

export function chatRouter(deps: ChatRouterDeps): Router {
  const router = Router();
  const { db, keyManager } = deps;

  // POST /api/chat/prompt
  router.post(
    "/prompt",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const parsed = chatPromptSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("validation_error", parsed.error.issues[0]?.message ?? "invalid input");
      const userId = req.auth!.userId;

      if (!req.user!.historyEnabled) {
        res.json({ recorded: false, reason: "history_disabled" });
        return;
      }

      const input = parsed.data;
      // Idempotency: the CLI retries syncs; the same clientRecordId must
      // not create duplicate records.
      if (input.clientRecordId) {
        const existing = findPromptByClientRecordId(db, userId, input.clientRecordId);
        if (existing) {
          const response = getResponseForPrompt(db, existing.id);
          res.json({ recorded: true, promptId: existing.id, responseId: response?.id });
          return;
        }
      }

      const forTraining = req.user!.trainingOptIn && (input.forTraining ?? false);
      const prompt = insertPrompt(db, {
        userId,
        sessionId: input.sessionId,
        provider: input.provider,
        model: input.model,
        prompt: input.prompt,
        forTraining,
        clientRecordId: input.clientRecordId,
      });
      let responseId: string | undefined;
      if (input.response !== undefined) {
        const response = insertResponse(db, {
          promptId: prompt.id,
          response: input.response,
          tokensUsed: input.tokensUsed,
          latencyMs: input.latencyMs,
        });
        responseId = response.id;
      }
      res.status(201).json({ recorded: true, promptId: prompt.id, responseId, forTraining });
    }),
  );

  // GET /api/chat/history
  router.get(
    "/history",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const parsed = historyQuerySchema.safeParse(req.query);
      if (!parsed.success) throw badRequest("validation_error", parsed.error.issues[0]?.message ?? "invalid query");
      const userId = req.auth!.userId;
      if (!req.user!.historyEnabled) {
        res.json({ records: [], disabled: true, total: 0 });
        return;
      }
      const records = historyForUser(db, userId, {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        sessionId: parsed.data.sessionId,
      });
      res.json({ records, total: countPromptsForUser(db, userId), disabled: false });
    }),
  );

  // POST /api/chat/feedback
  router.post(
    "/feedback",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const parsed = feedbackSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("validation_error", parsed.error.issues[0]?.message ?? "invalid input");
      const userId = req.auth!.userId;
      if (parsed.data.promptId) {
        const prompt = findPromptById(db, parsed.data.promptId);
        if (!prompt || prompt.userId !== userId) {
          throw httpError(404, "not_found", "Prompt not found.");
        }
      }
      const record = insertFeedback(db, {
        userId,
        promptId: parsed.data.promptId,
        rating: parsed.data.rating,
        comment: parsed.data.comment,
      });
      writeAudit(db, { actorId: userId, action: "feedback.add", targetType: "feedback", targetId: record.id });
      res.status(201).json({ id: record.id, rating: record.rating });
    }),
  );

  // POST /api/chat/completions — server-side proxy using the stored key.
  router.post(
    "/completions",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const parsed = chatCompletionsSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("validation_error", parsed.error.issues[0]?.message ?? "invalid input");
      const userId = req.auth!.userId;
      const row = getProviderKeyRow(db, userId, parsed.data.provider);
      if (!row) {
        throw httpError(404, "no_key", `No stored key for provider "${parsed.data.provider}". Run \`coder auth add ${parsed.data.provider}\`.`);
      }
      // Decrypt in memory only — the plaintext key never touches the DB.
      const apiKey = keyManager.decrypt(row.encryptedKey);
      const { proxyChat } = await import("../providers/proxy.js");
      const response = await proxyChat(parsed.data.provider, apiKey, {
        model: parsed.data.model,
        messages: parsed.data.messages,
        temperature: parsed.data.temperature,
        maxTokens: parsed.data.maxTokens,
      });
      // Best-effort recording when history is enabled.
      if (req.user!.historyEnabled) {
        const prompt = parsed.data.messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
        const promptRecord = insertPrompt(db, {
          userId,
          sessionId: "server-proxy",
          provider: parsed.data.provider,
          model: parsed.data.model,
          prompt,
          forTraining: false,
        });
        insertResponse(db, {
          promptId: promptRecord.id,
          response: response.content,
          tokensUsed: response.usage.outputTokens,
          latencyMs: undefined,
        });
      }
      res.json({ ...response });
    }),
  );

  return router;
}
