/**
 * Firebase Auth verification tests: RS256 ID-token verification against a
 * locally generated JWKS (no network needed).
 */

import { describe, expect, it } from "vitest";
import { signFirebaseTokenForTest, testRsaKeyPair, verifyFirebaseToken } from "../../../backend/src/auth/auth.js";

function makeToken(privatePem: string, kid: string, projectId: string, overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return signFirebaseTokenForTest(privatePem, { kid }, {
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    exp: now + 3600,
    iat: now,
    sub: "firebase-uid-123",
    email: "fire@example.com",
    ...overrides,
  });
}

describe("verifyFirebaseToken", () => {
  const projectId = "coder-test-project";
  const { publicJwk, privatePem } = testRsaKeyPair();
  const jwksCache = new Map<string, { keys: Array<Record<string, string>> }>();
  const fetchImpl = (async () => {
    throw new Error("should not hit the network — JWKS is cached");
  }) as unknown as typeof fetch;

  it("verifies a valid ID token (RS256, kid-matched)", async () => {
    // Seed the cache the way a real fetch would.
    const jwks = { keys: [{ ...publicJwk, kid: "test-kid-1", alg: "RS256" }] };
    const cache = new Map<string, { keys: Array<Record<string, string>> }>([["jwks", jwks]]);
    const token = makeToken(privatePem, "test-kid-1", projectId);
    const result = await verifyFirebaseToken(token, projectId, { fetchImpl, jwksCache: cache });
    expect(result).toEqual({ uid: "firebase-uid-123", email: "fire@example.com" });
  });

  it("rejects tokens signed with an unknown kid", async () => {
    const cache = new Map<string, { keys: Array<Record<string, string>> }>([
      ["jwks", { keys: [{ ...publicJwk, kid: "other-kid" }] }],
    ]);
    const token = makeToken(privatePem, "unknown-kid", projectId);
    expect(await verifyFirebaseToken(token, projectId, { fetchImpl, jwksCache: cache })).toBeNull();
  });

  it("rejects tokens for the wrong project (aud)", async () => {
    const cache = new Map<string, { keys: Array<Record<string, string>> }>([
      ["jwks", { keys: [{ ...publicJwk, kid: "k1" }] }],
    ]);
    const token = makeToken(privatePem, "k1", "another-project");
    expect(await verifyFirebaseToken(token, projectId, { fetchImpl, jwksCache: cache })).toBeNull();
  });

  it("rejects expired tokens", async () => {
    const cache = new Map<string, { keys: Array<Record<string, string>> }>([
      ["jwks", { keys: [{ ...publicJwk, kid: "k1" }] }],
    ]);
    const token = makeToken(privatePem, "k1", projectId, { exp: Math.floor(Date.now() / 1000) - 60 });
    expect(await verifyFirebaseToken(token, projectId, { fetchImpl, jwksCache: cache })).toBeNull();
  });

  it("rejects malformed tokens", async () => {
    expect(await verifyFirebaseToken("garbage", projectId, { fetchImpl, jwksCache })).toBeNull();
    expect(await verifyFirebaseToken("a.b", projectId, { fetchImpl, jwksCache })).toBeNull();
  });

  it("rejects HS256 tokens (alg confusion)", async () => {
    const { signJwt } = await import("../../../shared/src/index.js");
    const hs = signJwt({ sub: "x", role: "user", jti: "j" }, "secret", 600);
    expect(await verifyFirebaseToken(hs, projectId, { fetchImpl, jwksCache })).toBeNull();
  });
});
