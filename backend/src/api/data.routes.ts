/**
 * CODER backend — data ownership routes.
 *
 * - POST /api/export          full data bundle for the signed-in user
 * - POST /api/delete-account  GDPR-style erasure (cascade delete)
 */

import { Router } from "express";
import type { ExportBundle } from "../../../shared/src/index.js";
import { Database } from "../database/db.js";
import {
  deleteUser,
  findUserById,
  historyForUser,
  listProviderKeys,
  revokeAllUserSessions,
  userStats,
  writeAudit,
} from "../database/repos.js";
import { asyncHandler, requireAuth, type AuthedRequest } from "../auth/middleware.js";

export function dataRouter(db: Database): Router {
  const router = Router();

  // POST /api/export
  router.post(
    "/export",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const userId = req.auth!.userId;
      const user = findUserById(db, userId);
      if (!user) throw new Error("user vanished");
      const history = historyForUser(db, userId, { limit: 10_000, offset: 0 });
      const keys = listProviderKeys(db, userId);
      const bundle: ExportBundle = {
        exportedAt: new Date().toISOString(),
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          trainingOptIn: user.trainingOptIn,
          historyEnabled: user.historyEnabled,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
        settings: { historyEnabled: user.historyEnabled, trainingOptIn: user.trainingOptIn },
        providerKeys: keys.map((key) => ({
          provider: key.provider,
          fingerprint: key.keyHash.slice(0, 16),
          createdAt: key.createdAt,
        })),
        prompts: history.map((h) => ({
          id: h.promptId,
          userId,
          sessionId: h.sessionId,
          provider: h.provider,
          model: h.model,
          prompt: h.prompt,
          forTraining: false,
          createdAt: h.createdAt,
        })),
        responses: history
          .filter((h) => h.response !== undefined)
          .map((h) => ({
            id: `rs_${h.promptId}`,
            promptId: h.promptId,
            response: h.response!,
            tokensUsed: h.tokensUsed,
            latencyMs: h.latencyMs,
            createdAt: h.createdAt,
          })),
        feedback: [],
      };
      // Feedback rows (joined where possible).
      const feedbackRows = db.raw
        .prepare("SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at ASC")
        .all(userId) as Array<Record<string, unknown>>;
      bundle.feedback = feedbackRows.map((row) => ({
        id: String(row.id),
        userId: String(row.user_id),
        promptId: row.prompt_id === null ? undefined : String(row.prompt_id),
        rating: Number(row.rating),
        comment: row.comment === null ? undefined : String(row.comment),
        createdAt: String(row.created_at),
      }));

      writeAudit(db, { actorId: userId, action: "export.requested", targetType: "user", targetId: userId });
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="coder-export-${new Date().toISOString().slice(0, 10)}.json"`);
      res.json(bundle);
    }),
  );

  // POST /api/delete-account
  router.post(
    "/delete-account",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const userId = req.auth!.userId;
      const stats = userStats(db, userId);
      // Audit BEFORE deletion (audit rows deliberately outlive the user).
      writeAudit(db, {
        actorId: userId,
        action: "account.deleted",
        targetType: "user",
        targetId: userId,
        metadata: stats,
      });
      revokeAllUserSessions(db, userId);
      deleteUser(db, userId); // cascade removes sessions/keys/prompts/responses/feedback/consent
      res.json({ deleted: true, stats });
    }),
  );

  return router;
}
