/**
 * CODER backend — workspace routes (Phase 3).
 *
 * Repositories, indexed files, embeddings, checkpoints, patches and
 * search history — the server-side mirror of the CLI's workspace
 * intelligence layer, powering the dashboard's Workspace and admin
 * Repository analytics views.
 */

import { Router } from "express";
import { z } from "zod";
import { randomId } from "../../../shared/src/index.js";
import { Database } from "../database/db.js";
import { asyncHandler, badRequest, httpError, requireAdmin, requireAuth, type AuthedRequest } from "../auth/middleware.js";

const repoSchema = z.object({
  path: z.string().min(1).max(2000),
  name: z.string().min(1).max(300),
  language: z.string().max(50).optional(),
  fileCount: z.number().int().nonnegative().optional(),
  symbolCount: z.number().int().nonnegative().optional(),
  lineCount: z.number().int().nonnegative().optional(),
  indexedAt: z.string().optional(),
});

const filesSchema = z.object({
  files: z
    .array(z.object({
      path: z.string().min(1).max(1000),
      hash: z.string().min(1).max(128),
      size: z.number().int().nonnegative().optional(),
      language: z.string().max(50).optional(),
    }))
    .max(50_000),
});

const embeddingsSchema = z.object({
  model: z.string().max(100).optional(),
  embeddings: z.array(z.object({ path: z.string().min(1).max(1000), vector: z.array(z.number()).max(4096) })).max(50_000),
});

const now = () => new Date().toISOString();

export function workspaceRouter(db: Database): Router {
  const router = Router();
  router.use(requireAuth);

  // GET /api/workspace — summary for the dashboard.
  router.get(
    "/",
    asyncHandler(async (req: AuthedRequest, res) => {
      const userId = req.auth!.userId;
      const repos = db.raw
        .prepare("SELECT * FROM repositories WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100")
        .all(userId) as Array<Record<string, unknown>>;
      const searchHistory = db.raw
        .prepare("SELECT * FROM search_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 20")
        .all(userId) as Array<Record<string, unknown>>;
      const checkpoints = db.raw
        .prepare("SELECT * FROM checkpoints WHERE user_id = ? ORDER BY created_at DESC LIMIT 20")
        .all(userId) as Array<Record<string, unknown>>;
      const patches = db.raw
        .prepare("SELECT * FROM patches WHERE user_id = ? ORDER BY created_at DESC LIMIT 20")
        .all(userId) as Array<Record<string, unknown>>;
      res.json({
        repositories: repos.map(rowToRepo),
        searchHistory: searchHistory.map(rowToSearch),
        checkpoints: checkpoints.map(rowToCheckpoint),
        patches: patches.map(rowToPatch),
      });
    }),
  );

  // POST /api/workspace/repositories — upsert by (user, path).
  router.post(
    "/repositories",
    asyncHandler(async (req: AuthedRequest, res) => {
      const parsed = repoSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("validation_error", parsed.error.issues[0]?.message ?? "invalid input");
      const userId = req.auth!.userId;
      const { path, name, language, fileCount, symbolCount, lineCount, indexedAt } = parsed.data;
      const timestamp = now();
      const existing = db.raw
        .prepare("SELECT id FROM repositories WHERE user_id = ? AND path = ?")
        .get(userId, path) as { id: string } | undefined;
      const id = existing?.id ?? randomId("repo");
      if (existing) {
        db.raw
          .prepare(
            `UPDATE repositories SET name = ?, language = ?, file_count = ?, symbol_count = ?, line_count = ?, indexed_at = ?, updated_at = ? WHERE id = ?`,
          )
          .run(name, language ?? null, fileCount ?? 0, symbolCount ?? 0, lineCount ?? 0, indexedAt ?? timestamp, timestamp, id);
      } else {
        db.raw
          .prepare(
            `INSERT INTO repositories (id, user_id, path, name, language, file_count, symbol_count, line_count, indexed_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(id, userId, path, name, language ?? null, fileCount ?? 0, symbolCount ?? 0, lineCount ?? 0, indexedAt ?? timestamp, timestamp, timestamp);
      }
      res.status(201).json({ id, path });
    }),
  );

  // GET /api/workspace/repositories
  router.get(
    "/repositories",
    asyncHandler(async (req: AuthedRequest, res) => {
      const rows = db.raw
        .prepare("SELECT * FROM repositories WHERE user_id = ? ORDER BY updated_at DESC")
        .all(req.auth!.userId) as Array<Record<string, unknown>>;
      res.json({ repositories: rows.map(rowToRepo) });
    }),
  );

  // DELETE /api/workspace/repositories/:id
  router.delete(
    "/repositories/:id",
    asyncHandler(async (req: AuthedRequest, res) => {
      const result = db.raw
        .prepare("DELETE FROM repositories WHERE id = ? AND user_id = ?")
        .run(String(req.params.id ?? ""), req.auth!.userId);
      if (result.changes === 0) throw httpError(404, "not_found", "Repository not found.");
      res.json({ ok: true });
    }),
  );

  // POST /api/workspace/repositories/:id/files — replace the file index.
  router.post(
    "/repositories/:id/files",
    asyncHandler(async (req: AuthedRequest, res) => {
      const parsed = filesSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("validation_error", parsed.error.issues[0]?.message ?? "invalid input");
      const repoId = String(req.params.id ?? "");
      const owns = db.raw.prepare("SELECT 1 AS ok FROM repositories WHERE id = ? AND user_id = ?").get(repoId, req.auth!.userId) as { ok: number } | undefined;
      if (!owns) throw httpError(404, "not_found", "Repository not found.");
      const timestamp = now();
      const replace = db.raw.prepare("DELETE FROM indexed_files WHERE repository_id = ?");
      const insert = db.raw.prepare(
        "INSERT INTO indexed_files (id, repository_id, path, hash, size, language, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      db.transaction(() => {
        replace.run(repoId);
        for (const file of parsed.data.files) {
          insert.run(randomId("rec"), repoId, file.path, file.hash, file.size ?? 0, file.language ?? null, timestamp);
        }
      });
      res.json({ ok: true, files: parsed.data.files.length });
    }),
  );

  // POST /api/workspace/repositories/:id/embeddings — replace vectors.
  router.post(
    "/repositories/:id/embeddings",
    asyncHandler(async (req: AuthedRequest, res) => {
      const parsed = embeddingsSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("validation_error", parsed.error.issues[0]?.message ?? "invalid input");
      const repoId = String(req.params.id ?? "");
      const owns = db.raw.prepare("SELECT 1 AS ok FROM repositories WHERE id = ? AND user_id = ?").get(repoId, req.auth!.userId) as { ok: number } | undefined;
      if (!owns) throw httpError(404, "not_found", "Repository not found.");
      const timestamp = now();
      const replace = db.raw.prepare("DELETE FROM embeddings WHERE repository_id = ?");
      const insert = db.raw.prepare(
        "INSERT INTO embeddings (id, repository_id, path, vector, model, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      );
      db.transaction(() => {
        replace.run(repoId);
        for (const entry of parsed.data.embeddings) {
          insert.run(randomId("rec"), repoId, entry.path, JSON.stringify(entry.vector), parsed.data.model ?? "coder-local-hash-v1", timestamp);
        }
      });
      res.json({ ok: true, embeddings: parsed.data.embeddings.length });
    }),
  );

  // POST /api/workspace/search-history
  router.post(
    "/search-history",
    asyncHandler(async (req: AuthedRequest, res) => {
      const query = typeof req.body?.query === "string" ? req.body.query.slice(0, 500) : "";
      if (!query) throw badRequest("validation_error", "query is required");
      const kind = typeof req.body?.kind === "string" ? req.body.kind.slice(0, 50) : "content";
      const resultCount = typeof req.body?.resultCount === "number" ? req.body.resultCount : undefined;
      db.raw
        .prepare("INSERT INTO search_history (id, user_id, query, kind, result_count, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(randomId("rec"), req.auth!.userId, query, kind, resultCount ?? null, now());
      res.status(201).json({ ok: true });
    }),
  );

  // POST /api/workspace/checkpoints
  router.post(
    "/checkpoints",
    asyncHandler(async (req: AuthedRequest, res) => {
      const name = typeof req.body?.name === "string" ? req.body.name.slice(0, 200) : "";
      if (!name) throw badRequest("validation_error", "name is required");
      const repositoryId = typeof req.body?.repositoryId === "string" ? req.body.repositoryId : undefined;
      const fileCount = typeof req.body?.fileCount === "number" ? req.body.fileCount : 0;
      const id = randomId("rec");
      db.raw
        .prepare("INSERT INTO checkpoints (id, user_id, repository_id, name, file_count, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, req.auth!.userId, repositoryId ?? null, name, fileCount, now());
      res.status(201).json({ id });
    }),
  );

  // DELETE /api/workspace/checkpoints/:id
  router.delete(
    "/checkpoints/:id",
    asyncHandler(async (req: AuthedRequest, res) => {
      const result = db.raw
        .prepare("DELETE FROM checkpoints WHERE id = ? AND user_id = ?")
        .run(String(req.params.id ?? ""), req.auth!.userId);
      if (result.changes === 0) throw httpError(404, "not_found", "Checkpoint not found.");
      res.json({ ok: true });
    }),
  );

  // POST /api/workspace/patches
  router.post(
    "/patches",
    asyncHandler(async (req: AuthedRequest, res) => {
      const diff = typeof req.body?.diff === "string" ? req.body.diff : "";
      if (!diff) throw badRequest("validation_error", "diff is required");
      const summary = typeof req.body?.summary === "string" ? req.body.summary.slice(0, 500) : undefined;
      const repositoryId = typeof req.body?.repositoryId === "string" ? req.body.repositoryId : undefined;
      const id = randomId("rec");
      db.raw
        .prepare("INSERT INTO patches (id, user_id, repository_id, summary, diff, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, req.auth!.userId, repositoryId ?? null, summary ?? null, diff, now());
      res.status(201).json({ id });
    }),
  );

  return router;
}

function rowToRepo(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    path: String(row.path),
    name: String(row.name),
    language: row.language === null ? undefined : String(row.language),
    fileCount: Number(row.file_count ?? 0),
    symbolCount: Number(row.symbol_count ?? 0),
    lineCount: Number(row.line_count ?? 0),
    indexedAt: row.indexed_at === null ? undefined : String(row.indexed_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToSearch(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    query: String(row.query),
    kind: String(row.kind),
    resultCount: row.result_count === null ? undefined : Number(row.result_count),
    createdAt: String(row.created_at),
  };
}

function rowToCheckpoint(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    repositoryId: row.repository_id === null ? undefined : String(row.repository_id),
    fileCount: Number(row.file_count ?? 0),
    createdAt: String(row.created_at),
  };
}

function rowToPatch(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    summary: row.summary === null ? undefined : String(row.summary),
    repositoryId: row.repository_id === null ? undefined : String(row.repository_id),
    diffLength: String(row.diff ?? "").length,
    createdAt: String(row.created_at),
  };
}
