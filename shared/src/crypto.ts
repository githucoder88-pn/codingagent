/**
 * CODER — shared cryptography primitives (Phase 2).
 *
 * Used by both the CLI (local key vault) and the backend (encrypted
 * provider-key storage). Everything is built on node:crypto — no native
 * modules, no external deps.
 *
 * Envelope format: "<version>.<iv>.<authTag>.<ciphertext>" (base64url).
 * Versioned envelopes make key rotation possible without bulk rewrites
 * (see backend/src/encryption/key-manager.ts).
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const ENVELOPE_VERSION = "v1";

// ------------------------------------------------------------------ ids

/** Random id with a short prefix, e.g. `randomId("pr")` → "pr_ab12…". */
export function randomId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

/** Compare two byte buffers in constant time. */
function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- hashes

/** Fingerprint of a secret (API keys) for identification/deduplication. */
export function fingerprint(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

// -------------------------------------------------------------- scrypt

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const SCRYPT_KEYLEN = 32;

/**
 * Hash a password with scrypt. Format:
 * "scrypt$16384$8$1$<salt b64url>$<hash b64url>"
 */
export function scryptHash(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return [
    "scrypt",
    String(SCRYPT_PARAMS.N),
    String(SCRYPT_PARAMS.r),
    String(SCRYPT_PARAMS.p),
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

/** Verify a password against a stored scrypt hash. */
export function scryptVerify(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64 ?? "", "base64url");
  const expected = Buffer.from(hashB64 ?? "", "base64url");
  const actual = scryptSync(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return safeEqual(actual, expected);
}

// ----------------------------------------------------------- encryption

function toB64(buf: Buffer): string {
  return buf.toString("base64url");
}

function fromB64(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

/** Encrypt a string with AES-256-GCM, returning a versioned envelope. */
export function encryptSecret(key: Buffer, plaintext: string, version = ENVELOPE_VERSION): string {
  if (key.length !== KEY_BYTES) throw new Error(`encryption key must be ${KEY_BYTES} bytes`);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${version}.${toB64(iv)}.${toB64(tag)}.${toB64(encrypted)}`;
}

/** Decrypt a versioned envelope. Throws on tampering or wrong key. */
export function decryptSecret(key: Buffer, envelope: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 4) throw new Error("invalid ciphertext envelope");
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(ALGO, key, fromB64(ivB64 ?? ""));
  decipher.setAuthTag(fromB64(tagB64 ?? ""));
  const decrypted = Buffer.concat([decipher.update(fromB64(ctB64 ?? "")), decipher.final()]);
  return decrypted.toString("utf8");
}

/** Parse the version prefix of an envelope. */
export function envelopeVersion(envelope: string): string {
  const version = envelope.split(".")[0];
  if (!version) throw new Error("invalid ciphertext envelope");
  return version;
}

/** Generate a new 32-byte master key (hex string). */
export function newMasterKeyHex(): string {
  return randomBytes(KEY_BYTES).toString("hex");
}

/** Master key hex → Buffer. */
export function masterKeyFromHex(hex: string): Buffer {
  return Buffer.from(hex, "hex");
}

// ------------------------------------------------------------------ JWT

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function b64urlDecode(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

export interface JwtPayload {
  sub: string;
  role: string;
  jti: string;
  iat: number;
  exp: number;
}

/** Sign an HS256 JWT with the given secret. */
export function signJwt(
  payload: { sub: string; role: string; jti: string },
  secret: string,
  ttlSeconds: number,
  now = Date.now(),
): string {
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ ...payload, iat, exp: iat + ttlSeconds }));
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

/** Verify an HS256 JWT. Returns the payload or null. */
export function verifyJwt(token: string, secret: string, now = Date.now()): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, bodyB64, signature] = parts;
  let header: Record<string, unknown>;
  let body: Record<string, unknown>;
  try {
    header = JSON.parse(b64urlDecode(headerB64 ?? "").toString("utf8")) as Record<string, unknown>;
    body = JSON.parse(b64urlDecode(bodyB64 ?? "").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (header.alg !== "HS256") return null;
  const expected = createHmac("sha256", secret).update(`${headerB64}.${bodyB64}`).digest();
  const actual = b64urlDecode(signature ?? "");
  if (!safeEqual(actual, expected)) return null;
  if (typeof body.exp !== "number" || body.exp * 1000 <= now) return null;
  if (typeof body.sub !== "string" || typeof body.jti !== "string") return null;
  return {
    sub: body.sub,
    role: typeof body.role === "string" ? body.role : "user",
    jti: body.jti,
    iat: typeof body.iat === "number" ? body.iat : 0,
    exp: body.exp,
  };
}
