/**
 * CODER backend — HTTP middleware.
 *
 * Express middleware: bearer-token auth, admin role gate, and the JSON
 * error envelope used by every endpoint.
 */

import type { NextFunction, Request, Response } from "express";
import { authenticateToken, type AuthDeps } from "./auth.js";
import { Database } from "../database/db.js";
import { findUserById } from "../database/repos.js";
import type { PublicUser, Role, User } from "../../../shared/src/index.js";

export interface AuthedRequest extends Request {
  auth?: { userId: string; role: Role; jti: string };
  user?: User;
}

export function publicUser(user: User): PublicUser {
  const { hashedPassword: _ignored, ...rest } = user;
  return rest;
}

export function authMiddleware(db: Database, deps: AuthDeps) {
  return (req: AuthedRequest, _res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      next();
      return;
    }
    const payload = authenticateToken(db, deps, header.slice(7));
    if (!payload) {
      next();
      return;
    }
    const user = findUserById(db, payload.sub);
    if (!user) {
      next();
      return;
    }
    req.auth = { userId: user.id, role: user.role, jti: payload.jti };
    req.user = user;
    next();
  };
}

/** Require a valid session (403 JSON error otherwise). */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.auth || !req.user) {
    res.status(401).json({ error: { code: "unauthorized", message: "Not signed in. Run `coder login`." } });
    return;
  }
  next();
}

/** Require an admin (or superadmin) role. */
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.auth || !req.user) {
    res.status(401).json({ error: { code: "unauthorized", message: "Not signed in. Run `coder login`." } });
    return;
  }
  if (req.user.role !== "admin" && req.user.role !== "superadmin") {
    res.status(403).json({ error: { code: "forbidden", message: "Admin access required." } });
    return;
  }
  next();
}

export interface ApiError extends Error {
  status?: number;
  code?: string;
}

export function httpError(status: number, code: string, message: string): ApiError {
  const err = new Error(message) as ApiError;
  err.status = status;
  err.code = code;
  return err;
}

export const badRequest = (code: string, message: string) => httpError(400, code, message);
export const notFound = (message: string) => httpError(404, "not_found", message);
export const conflict = (code: string, message: string) => httpError(409, code, message);

/** Express error handler → uniform {error:{code,message}} JSON. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const apiErr = err as ApiError;
  const status = apiErr.status ?? 500;
  const code = apiErr.code ?? "internal_error";
  const message = status >= 500 ? "Internal server error" : apiErr.message;
  if (status >= 500) {
    process.stderr.write(`[coder-server] ${(err as Error).stack ?? String(err)}\n`);
  }
  res.status(status).json({ error: { code, message } });
}

/** Wrap an async route handler (Express 5 forwards rejections, but this
 *  keeps the code explicit and works on Express 4 too). */
export function asyncHandler(fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<void>) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
