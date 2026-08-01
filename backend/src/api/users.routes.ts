/**
 * CODER backend — user routes (profile, settings, stats).
 */

import { Router } from "express";
import { settingsPatchSchema } from "../../../shared/src/index.js";
import { Database } from "../database/db.js";
import { setTrainingConsent, updateUserSettings, userStats, writeAudit } from "../database/repos.js";
import { asyncHandler, badRequest, publicUser, requireAuth, type AuthedRequest } from "../auth/middleware.js";

export function usersRouter(db: Database): Router {
  const router = Router();

  // GET /api/users/me
  router.get(
    "/me",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      res.json({
        user: publicUser(req.user!),
        settings: { historyEnabled: req.user!.historyEnabled, trainingOptIn: req.user!.trainingOptIn },
      });
    }),
  );

  // PATCH /api/users/me/settings
  router.patch(
    "/me/settings",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const parsed = settingsPatchSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("validation_error", parsed.error.issues[0]?.message ?? "invalid input");
      const user = updateUserSettings(db, req.auth!.userId, parsed.data);
      if (parsed.data.trainingOptIn !== undefined) {
        setTrainingConsent(db, user.id, parsed.data.trainingOptIn);
      }
      writeAudit(db, {
        actorId: user.id,
        action: "settings.update",
        targetType: "user",
        targetId: user.id,
        metadata: parsed.data,
      });
      res.json({
        user: publicUser(user),
        settings: { historyEnabled: user.historyEnabled, trainingOptIn: user.trainingOptIn },
      });
    }),
  );

  // GET /api/users/me/stats
  router.get(
    "/me/stats",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      res.json({ stats: userStats(db, req.auth!.userId) });
    }),
  );

  return router;
}
