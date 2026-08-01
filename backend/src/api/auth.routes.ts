/**
 * CODER backend — auth + provider-key routes.
 */

import { Router } from "express";
import { fingerprint } from "../../../shared/src/index.js";
import { providerKeySchema, loginSchema, signupSchema } from "../../../shared/src/index.js";
import { Database } from "../database/db.js";
import {
  createUser,
  deleteProviderKey,
  findUserByEmail,
  findUserByFirebaseUid,
  getProviderKeyRow,
  listProviderKeys,
  upsertProviderKey,
  writeAudit,
} from "../database/repos.js";
import { issueSession, revokeSession, scryptHash, scryptVerify } from "../auth/auth.js";
import { asyncHandler, badRequest, conflict, httpError, publicUser, requireAuth, type AuthedRequest } from "../auth/middleware.js";
import type { KeyManager } from "../encryption/key-manager.js";
import type { AuthDeps } from "../auth/auth.js";
import { verifyFirebaseToken } from "../auth/auth.js";

export interface AuthRouterDeps {
  db: Database;
  keyManager: KeyManager;
  auth: AuthDeps;
  firebaseProjectId?: string;
}

export function authRouter(deps: AuthRouterDeps): Router {
  const router = Router();
  const { db, keyManager, auth } = deps;

  // POST /api/auth/signup
  router.post(
    "/signup",
    asyncHandler(async (req, res) => {
      const parsed = signupSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("validation_error", parsed.error.issues[0]?.message ?? "invalid input");
      const { email, password } = parsed.data;
      if (findUserByEmail(db, email)) throw conflict("email_taken", "An account with this email already exists.");
      const user = createUser(db, { email, hashedPassword: scryptHash(password) });
      const token = issueSession(db, auth, user.id);
      writeAudit(db, { actorId: user.id, action: "auth.signup", targetType: "user", targetId: user.id });
      res.status(201).json({ token, user: publicUser(user) });
    }),
  );

  // POST /api/auth/login
  router.post(
    "/login",
    asyncHandler(async (req, res) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("validation_error", parsed.error.issues[0]?.message ?? "invalid input");
      const { email, password } = parsed.data;
      const user = findUserByEmail(db, email);
      if (!user || !user.hashedPassword || !scryptVerify(password, user.hashedPassword)) {
        throw httpError(401, "invalid_credentials", "Invalid email or password.");
      }
      const token = issueSession(db, auth, user.id);
      writeAudit(db, { actorId: user.id, action: "auth.login", targetType: "user", targetId: user.id });
      res.json({ token, user: publicUser(user) });
    }),
  );

  // POST /api/auth/logout
  router.post(
    "/logout",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const header = req.headers.authorization ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      if (token && req.auth) {
        revokeSession(db, token, auth);
        writeAudit(db, { actorId: req.auth.userId, action: "auth.logout", targetType: "user", targetId: req.auth.userId });
      }
      res.json({ ok: true });
    }),
  );

  // GET /api/auth/session
  router.get(
    "/session",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const user = req.user!;
      res.json({ user: publicUser(user) });
    }),
  );

  // POST /api/auth/provider-key  (also upserts on re-add)
  router.post(
    "/provider-key",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const parsed = providerKeySchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("validation_error", parsed.error.issues[0]?.message ?? "invalid input");
      const { provider, apiKey } = parsed.data;
      const encrypted = keyManager.encrypt(apiKey);
      const record = upsertProviderKey(db, {
        userId: req.auth!.userId,
        provider,
        encryptedKey: encrypted,
        keyHash: fingerprint(apiKey),
      });
      writeAudit(db, {
        actorId: req.auth!.userId,
        action: "key.add",
        targetType: "provider_key",
        targetId: record.id,
        metadata: { provider },
      });
      res.status(201).json({
        id: record.id,
        provider,
        fingerprint: record.keyHash.slice(0, 16),
        storedEncrypted: true,
      });
    }),
  );

  // GET /api/auth/provider-keys
  router.get(
    "/provider-keys",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const keys = listProviderKeys(db, req.auth!.userId).map((key) => ({
        provider: key.provider,
        fingerprint: key.keyHash.slice(0, 16),
        createdAt: key.createdAt,
        updatedAt: key.updatedAt,
      }));
      res.json({ keys });
    }),
  );

  // DELETE /api/auth/provider-key/:provider
  router.delete(
    "/provider-key/:provider",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const provider = String(req.params.provider ?? "");
      if (!["openai", "anthropic", "gemini", "openrouter"].includes(provider)) {
        throw badRequest("validation_error", `Unknown provider "${provider}".`);
      }
      const removed = deleteProviderKey(db, req.auth!.userId, provider);
      if (!removed) throw httpError(404, "not_found", `No stored key for provider "${provider}".`);
      writeAudit(db, { actorId: req.auth!.userId, action: "key.remove", targetType: "provider_key", metadata: { provider } });
      res.json({ ok: true });
    }),
  );

  // POST /api/auth/firebase  (Firebase ID-token exchange)
  router.post(
    "/firebase",
    asyncHandler(async (req, res) => {
      if (!deps.firebaseProjectId) {
        throw httpError(501, "firebase_not_configured", "Firebase Auth is not configured on this server.");
      }
      const idToken = typeof req.body?.idToken === "string" ? req.body.idToken : "";
      if (!idToken) throw badRequest("validation_error", "Missing idToken.");
      const result = await verifyFirebaseToken(idToken, deps.firebaseProjectId);
      if (!result) throw httpError(401, "invalid_token", "Invalid Firebase ID token.");
      let user = result.email ? findUserByEmail(db, result.email) : undefined;
      if (!user) user = findUserByFirebaseUid(db, result.uid);
      if (!user) {
        if (!result.email) throw badRequest("validation_error", "Firebase account has no email; cannot create user.");
        user = createUser(db, { email: result.email, firebaseUid: result.uid });
      }
      const token = issueSession(db, auth, user.id);
      writeAudit(db, { actorId: user.id, action: "auth.login", targetType: "user", targetId: user.id, metadata: { via: "firebase" } });
      res.json({ token, user: publicUser(user) });
    }),
  );

  return router;
}
