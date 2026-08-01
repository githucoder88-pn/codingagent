/**
 * CODER backend — admin routes.
 *
 * All endpoints require an admin (or superadmin) role. Read-only analytics
 * plus key-rotation (the one security-critical mutation).
 */

import { Router } from "express";
import { adminQuerySchema } from "../../../shared/src/index.js";
import { Database } from "../database/db.js";
import {
  allProviderKeyRows,
  adminPrompts,
  listAuditLogs,
  listFeedback,
  listModelMetadata,
  listUsers,
  trainingDataset,
  trainingStats,
  updateEncryptedKey,
  usageRollups,
  writeAudit,
} from "../database/repos.js";
import { asyncHandler, badRequest, httpError, requireAdmin, type AuthedRequest } from "../auth/middleware.js";
import type { KeyManager } from "../encryption/key-manager.js";

export interface AdminRouterDeps {
  db: Database;
  keyManager: KeyManager;
}

export function adminRouter(deps: AdminRouterDeps): Router {
  const router = Router();
  const { db, keyManager } = deps;

  router.use(requireAdmin);

  // GET /api/admin/users
  router.get(
    "/users",
    asyncHandler(async (req: AuthedRequest, res) => {
      const parsed = adminQuerySchema.safeParse(req.query);
      if (!parsed.success) throw badRequest("validation_error", parsed.error.issues[0]?.message ?? "invalid query");
      const { users, total } = listUsers(db, {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        search: parsed.data.search,
      });
      res.json({
        users: users.map(({ hashedPassword: _ignored, ...user }) => user),
        total,
      });
    }),
  );

  // GET /api/admin/prompts
  router.get(
    "/prompts",
    asyncHandler(async (req: AuthedRequest, res) => {
      const parsed = adminQuerySchema.safeParse(req.query);
      if (!parsed.success) throw badRequest("validation_error", parsed.error.issues[0]?.message ?? "invalid query");
      res.json({ prompts: adminPrompts(db, { limit: parsed.data.limit, offset: parsed.data.offset }) });
    }),
  );

  // GET /api/admin/feedback
  router.get(
    "/feedback",
    asyncHandler(async (req: AuthedRequest, res) => {
      const parsed = adminQuerySchema.safeParse(req.query);
      if (!parsed.success) throw badRequest("validation_error", parsed.error.issues[0]?.message ?? "invalid query");
      const items = listFeedback(db, { limit: parsed.data.limit, offset: parsed.data.offset });
      const ratings = db.raw.prepare("SELECT rating, COUNT(*) AS c FROM feedback GROUP BY rating").all() as Array<{ rating: number; c: number }>;
      res.json({ feedback: items, ratingDistribution: ratings });
    }),
  );

  // GET /api/admin/logs
  router.get(
    "/logs",
    asyncHandler(async (req: AuthedRequest, res) => {
      const parsed = adminQuerySchema.safeParse(req.query);
      if (!parsed.success) throw badRequest("validation_error", parsed.error.issues[0]?.message ?? "invalid query");
      res.json({ logs: listAuditLogs(db, { limit: parsed.data.limit, offset: parsed.data.offset, action: parsed.data.action }) });
    }),
  );

  // GET /api/admin/training
  router.get(
    "/training",
    asyncHandler(async (_req, res) => {
      res.json(trainingStats(db));
    }),
  );

  // GET /api/admin/training/dataset
  router.get(
    "/training/dataset",
    asyncHandler(async (req: AuthedRequest, res) => {
      const parsed = adminQuerySchema.safeParse(req.query);
      if (!parsed.success) throw badRequest("validation_error", parsed.error.issues[0]?.message ?? "invalid query");
      const rows = trainingDataset(db, { limit: parsed.data.limit, offset: parsed.data.offset });
      writeAudit(db, { actorId: req.auth!.userId, action: "admin.training.dataset", targetType: "training" });
      res.json({ rows, stats: trainingStats(db) });
    }),
  );

  // GET /api/admin/models — provider/model metadata seen in recorded prompts
  router.get(
    "/models",
    asyncHandler(async (req: AuthedRequest, res) => {
      const parsed = adminQuerySchema.safeParse(req.query);
      if (!parsed.success) throw badRequest("validation_error", parsed.error.issues[0]?.message ?? "invalid query");
      res.json({
        models: listModelMetadata(db, {
          limit: parsed.data.limit,
          offset: parsed.data.offset,
          provider: parsed.data.search,
        }),
      });
    }),
  );

  // GET /api/admin/usage
  router.get(
    "/usage",
    asyncHandler(async (req: AuthedRequest, res) => {
      const parsed = adminQuerySchema.safeParse(req.query);
      if (!parsed.success) throw badRequest("validation_error", parsed.error.issues[0]?.message ?? "invalid query");
      res.json({ usage: usageRollups(db, parsed.data.days) });
    }),
  );

  // POST /api/admin/rotate-key — rotate the master encryption key and
  // re-encrypt every stored provider key.
  router.post(
    "/rotate-key",
    asyncHandler(async (req: AuthedRequest, res) => {
      if (req.user!.role !== "superadmin") {
        throw httpError(403, "forbidden", "Key rotation requires the superadmin role.");
      }
      let reencrypted = 0;
      keyManager.rotate(() => {
        const all = allProviderKeyRows(db);
        for (const row of all) {
          const plain = keyManager.decrypt(row.encryptedKey);
          updateEncryptedKey(db, row.id, keyManager.encrypt(plain));
          reencrypted += 1;
        }
        return reencrypted;
      });
      writeAudit(db, {
        actorId: req.auth!.userId,
        action: "admin.rotate-key",
        targetType: "encryption",
        metadata: { reencrypted, version: keyManager.activeVersionId },
      });
      res.json({ ok: true, reencrypted, activeVersion: keyManager.activeVersionId });
    }),
  );

  return router;
}
