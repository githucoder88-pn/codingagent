/**
 * CODER backend — HTTP server.
 *
 * Composes the Express app: JSON parsing, auth middleware, API routers,
 * the web dashboard (static SPA), and the uniform error handler.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import { API_PREFIX } from "../../shared/src/index.js";
import { Database } from "./database/db.js";
import { KeyManager } from "./encryption/key-manager.js";
import { authRouter } from "./api/auth.routes.js";
import { usersRouter } from "./api/users.routes.js";
import { chatRouter } from "./api/chat.routes.js";
import { adminRouter } from "./api/admin.routes.js";
import { dataRouter } from "./api/data.routes.js";
import { errorHandler, authMiddleware } from "./auth/middleware.js";
import { createUser, findUserByEmail, setUserRole, writeAudit } from "./database/repos.js";
import { scryptHash } from "./auth/auth.js";
import type { ServerConfig } from "./config.js";

export interface BackendContext {
  app: Express;
  db: Database;
  keyManager: KeyManager;
  config: ServerConfig;
  close: () => Promise<void>;
}

/** Resolve the dashboard web root (dist/ when bundled, web/ in dev). */
export function webRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [here, join(here, "web"), join(here, "..", "..", "web")];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.html"))) return candidate;
  }
  return candidates[0]!;
}

export async function createServer(config: ServerConfig): Promise<BackendContext> {
  const db = await Database.open(config.dbPath);
  const keyManager = new KeyManager(config.serverDir, config.masterKeyHex);
  keyManager.load();

  const auth = {
    jwtSecret: config.jwtSecret,
    tokenTtlSeconds: config.tokenTtlSeconds,
  };

  // Seed the admin account from environment (idempotent, promotes user→admin).
  if (config.adminEmail && config.adminPassword) {
    const role = config.adminSuperadmin ? "superadmin" : "admin";
    const existing = findUserByEmail(db, config.adminEmail);
    if (existing) {
      setUserRole(db, existing.id, role);
    } else {
      const admin = createUser(db, {
        email: config.adminEmail,
        hashedPassword: scryptHash(config.adminPassword),
        role,
      });
      writeAudit(db, { actorId: admin.id, action: "admin.seeded", targetType: "user", targetId: admin.id });
    }
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));

  // Health endpoint (no auth).
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, version: "0.2.0", name: "coder-backend" });
  });

  // Resolve the signed-in user (when a valid Bearer token is present);
  // individual routes enforce auth/roles as needed.
  app.use(authMiddleware(db, auth));

  // API routers.
  app.use(
    `${API_PREFIX}/auth`,
    authRouter({ db, keyManager, auth, firebaseProjectId: config.firebaseProjectId }),
  );
  app.use(`${API_PREFIX}/users`, usersRouter(db));
  app.use(`${API_PREFIX}/chat`, chatRouter({ db, keyManager }));
  app.use(`${API_PREFIX}/admin`, adminRouter({ db, keyManager }));
  app.use(API_PREFIX, dataRouter(db));

  // 404 for unknown API routes.
  app.use(`${API_PREFIX}/`, (_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Unknown API endpoint." } });
  });

  // Web dashboard (static SPA) — served at /.
  const web = webRoot();
  app.use(express.static(web, { index: "index.html" }));
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith(API_PREFIX)) {
      res.sendFile(join(web, "index.html"), (err) => {
        if (err) next();
      });
      return;
    }
    next();
  });

  app.use(errorHandler);

  return {
    app,
    db,
    keyManager,
    config,
    close: async () => {
      db.close();
    },
  };
}
