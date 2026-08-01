import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  envelopeVersion,
  fingerprint,
  masterKeyFromHex,
  newMasterKeyHex,
  randomId,
  scryptHash,
  scryptVerify,
  signJwt,
  verifyJwt,
} from "../../../shared/src/index.js";

const KEY = masterKeyFromHex(newMasterKeyHex());

describe("envelope encryption", () => {
  it("round-trips secrets", () => {
    const envelope = encryptSecret(KEY, "sk-super-secret-123");
    expect(decryptSecret(KEY, envelope)).toBe("sk-super-secret-123");
  });

  it("is versioned and opaque", () => {
    const envelope = encryptSecret(KEY, "abc");
    expect(envelopeVersion(envelope)).toBe("v1");
    expect(envelope).not.toContain("abc");
  });

  it("produces unique ciphertexts per call (random IV)", () => {
    expect(encryptSecret(KEY, "same")).not.toBe(encryptSecret(KEY, "same"));
  });

  it("fails on tampered ciphertext", () => {
    const envelope = encryptSecret(KEY, "hello");
    const tampered = `${envelope.slice(0, -4)}AAAA`;
    expect(() => decryptSecret(KEY, tampered)).toThrow();
  });

  it("fails with the wrong key", () => {
    const envelope = encryptSecret(KEY, "hello");
    expect(() => decryptSecret(masterKeyFromHex(newMasterKeyHex()), envelope)).toThrow();
  });

  it("rejects malformed envelopes", () => {
    expect(() => decryptSecret(KEY, "not-an-envelope")).toThrow();
  });
});

describe("fingerprints", () => {
  it("hashes deterministically with sha256", () => {
    expect(fingerprint("sk-abc")).toBe(fingerprint("sk-abc"));
    expect(fingerprint("sk-abc")).not.toBe(fingerprint("sk-abd"));
    expect(fingerprint("sk-abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("scrypt passwords", () => {
  it("hashes and verifies", () => {
    const hash = scryptHash("correct horse battery staple");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(scryptVerify("correct horse battery staple", hash)).toBe(true);
    expect(scryptVerify("wrong password", hash)).toBe(false);
  });

  it("uses unique salts", () => {
    expect(scryptHash("same")).not.toBe(scryptHash("same"));
  });

  it("rejects malformed stored hashes", () => {
    expect(scryptVerify("x", "not-a-scrypt-hash")).toBe(false);
  });
});

describe("JWT", () => {
  const secret = newMasterKeyHex();

  it("signs and verifies HS256 tokens", () => {
    const token = signJwt({ sub: "u_1", role: "admin", jti: "jti-1" }, secret, 600);
    const payload = verifyJwt(token, secret);
    expect(payload?.sub).toBe("u_1");
    expect(payload?.role).toBe("admin");
    expect(payload?.jti).toBe("jti-1");
    expect(payload?.exp).toBe(payload!.iat + 600);
  });

  it("rejects expired tokens", () => {
    const token = signJwt({ sub: "u_1", role: "user", jti: "j" }, secret, 600, Date.now() - 700_000);
    expect(verifyJwt(token, secret)).toBeNull();
  });

  it("rejects tokens signed with another secret", () => {
    const token = signJwt({ sub: "u_1", role: "user", jti: "j" }, secret, 600);
    expect(verifyJwt(token, newMasterKeyHex())).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyJwt("a.b.c", secret)).toBeNull();
    expect(verifyJwt("", secret)).toBeNull();
  });
});

describe("ids", () => {
  it("generates prefixed ids", () => {
    expect(randomId("pr")).toMatch(/^pr_[A-Za-z0-9_-]{12}$/);
    expect(randomId("u")).toMatch(/^u_/);
  });
});
