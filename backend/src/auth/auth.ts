/**
 * CODER backend — authentication primitives.
 *
 * - Passwords: scrypt hashing (never stored in plain text)
 * - API sessions: HS256 JWTs with server-side revocation via jti
 * - Firebase Auth: optional RS256 token verification via Google JWKS
 *   (identity only — CODER owns the application database).
 */

import { createPublicKey, createSign, createVerify, generateKeyPairSync, randomBytes } from "node:crypto";
import { scryptHash, scryptVerify, signJwt, verifyJwt, type JwtPayload } from "../../../shared/src/index.js";
import { Database } from "../database/db.js";
import { apiSessionActive, createApiSession, findUserById, revokeApiSession } from "../database/repos.js";

export interface AuthDeps {
  jwtSecret: string;
  tokenTtlSeconds: number;
  now?: () => number;
}

// ------------------------------------------------------------- password

export { scryptHash, scryptVerify };

// ------------------------------------------------------------------ jwt

/** Create a session for a user; returns the JWT. */
export function issueSession(db: Database, deps: AuthDeps, userId: string): string {
  const jti = randomBytes(16).toString("hex");
  const nowMs = deps.now?.() ?? Date.now();
  const token = signJwt(
    { sub: userId, role: findUserById(db, userId)?.role ?? "user", jti },
    deps.jwtSecret,
    deps.tokenTtlSeconds,
    nowMs,
  );
  const expiresAt = new Date(nowMs + deps.tokenTtlSeconds * 1000).toISOString();
  createApiSession(db, jti, userId, expiresAt);
  return token;
}

export function revokeSession(db: Database, token: string, deps: AuthDeps): void {
  const payload = verifyJwt(token, deps.jwtSecret, deps.now?.() ?? Date.now());
  if (payload) revokeApiSession(db, payload.jti);
}

/** Verify a bearer token and check the server-side session is alive. */
export function authenticateToken(db: Database, deps: AuthDeps, token: string): JwtPayload | null {
  const payload = verifyJwt(token, deps.jwtSecret, deps.now?.() ?? Date.now());
  if (!payload) return null;
  if (!apiSessionActive(db, payload.jti, new Date(deps.now?.() ?? Date.now()).toISOString())) return null;
  return payload;
}

// -------------------------------------------------------------- firebase

export interface FirebaseVerifyResult {
  uid: string;
  email?: string;
}

interface Jwks {
  keys: Array<Record<string, string>>;
}

/**
 * Verify a Firebase ID token (RS256) against Google's JWKS.
 * The fetch implementation and JWKS cache are injectable for tests.
 */
export async function verifyFirebaseToken(
  token: string,
  projectId: string,
  opts: {
    fetchImpl?: typeof fetch;
    jwksCache?: Map<string, Jwks>;
  } = {},
): Promise<FirebaseVerifyResult | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cache = opts.jwksCache ?? new Map<string, Jwks>();

  const [headerB64, bodyB64, signatureB64] = token.split(".");
  if (!headerB64 || !bodyB64 || !signatureB64) return null;

  let header: Record<string, unknown>;
  let body: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8")) as Record<string, unknown>;
    body = JSON.parse(Buffer.from(bodyB64, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;
  const kid = typeof header.kid === "string" ? header.kid : undefined;
  if (!kid) return null;

  // Claims validation.
  if (body.aud !== projectId) return null;
  if (body.iss !== `https://securetoken.google.com/${projectId}`) return null;
  const exp = typeof body.exp === "number" ? body.exp : 0;
  if (exp * 1000 <= Date.now()) return null;

  const jwksUrl = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
  let jwks = cache.get("jwks");
  if (!jwks) {
    const res = await fetchImpl(jwksUrl);
    if (!res.ok) throw new Error(`Firebase JWKS fetch failed: HTTP ${res.status}`);
    jwks = (await res.json()) as Jwks;
    cache.set("jwks", jwks);
  }
  const jwk = jwks.keys.find((key) => key.kid === kid);
  if (!jwk) return null;

  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${bodyB64}`);
  const valid = verifier.verify(publicKey, Buffer.from(signatureB64, "base64url"));
  if (!valid) return null;

  return {
    uid: typeof body.sub === "string" ? body.sub : "",
    email: typeof body.email === "string" ? body.email : undefined,
  };
}

/** Sign a Firebase-style RS256 JWT (used only by tests). */
export function signFirebaseTokenForTest(
  privateKeyPem: string,
  header: { kid: string; alg?: string },
  payload: Record<string, unknown>,
): string {
  const encode = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const headerB64 = encode({ alg: header.alg ?? "RS256", typ: "JWT", kid: header.kid });
  const bodyB64 = encode(payload);
  const signer = createSign("RSA-SHA256");
  signer.update(`${headerB64}.${bodyB64}`);
  const signature = signer.sign(privateKeyPem).toString("base64url");
  return `${headerB64}.${bodyB64}.${signature}`;
}

/** Generate an RSA keypair (used only by tests). */
export function testRsaKeyPair(): { publicJwk: Record<string, string>; privatePem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    publicJwk: publicKey.export({ format: "jwk" }) as Record<string, string>,
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
  };
}
