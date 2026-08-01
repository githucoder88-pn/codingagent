import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KeyManager } from "../../../backend/src/encryption/key-manager.js";

function tempKeysDir(): string {
  return mkdtempSync(join(tmpdir(), "coder-keys-"));
}

describe("KeyManager", () => {
  it("creates a key file on first load and encrypts/decrypts", () => {
    const dir = tempKeysDir();
    try {
      const km = new KeyManager(dir);
      km.load();
      const envelope = km.encrypt("sk-secret");
      expect(km.decrypt(envelope)).toBe("sk-secret");
      const versions = JSON.parse(readFileSync(join(dir, "keys.json"), "utf8")) as { active: string; versions: Record<string, unknown> };
      expect(versions.active).toBe("v1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists keys across instances", () => {
    const dir = tempKeysDir();
    try {
      const first = new KeyManager(dir);
      first.load();
      const envelope = first.encrypt("persisted");

      const second = new KeyManager(dir);
      second.load();
      expect(second.decrypt(envelope)).toBe("persisted");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rotates: new envelopes use v2, old rows re-encrypt, archives keep old keys", () => {
    const dir = tempKeysDir();
    try {
      const km = new KeyManager(dir);
      km.load();
      const rows = [{ id: "pk_1", encryptedKey: km.encrypt("key-one") }];

      const rotated = km.rotate(() => {
        // Re-encrypt every row with the (new) active key.
        rows[0] = { id: rows[0]!.id, encryptedKey: km.encrypt(km.decrypt(rows[0]!.encryptedKey)) };
        return 1;
      });
      expect(rotated).toBe(1);
      expect(km.activeVersionId).toBe("v2");
      expect(km.decrypt(rows[0]!.encryptedKey)).toBe("key-one"); // archived v1 still decrypts
      expect(km.decrypt(km.encrypt("fresh"))).toBe("fresh"); // v2 works

      const versions = JSON.parse(readFileSync(join(dir, "keys.json"), "utf8")) as {
        active: string;
        versions: Record<string, { keyHex: string }>;
      };
      expect(versions.active).toBe("v2");
      expect(Object.keys(versions.versions)).toEqual(["v1", "v2"]);
      expect(versions.versions.v1!.keyHex).not.toBe(versions.versions.v2!.keyHex);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses rotation when the key comes from the environment", () => {
    const dir = tempKeysDir();
    try {
      const km = new KeyManager(dir, "a".repeat(64));
      km.load();
      expect(() => km.rotate(() => 0)).toThrow(/environment/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails clearly when an envelope version is unknown", () => {
    const dir = tempKeysDir();
    try {
      const km = new KeyManager(dir);
      km.load();
      expect(() => km.decrypt("v99.aaaa.bbbb.cccc")).toThrow(/no key available/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
