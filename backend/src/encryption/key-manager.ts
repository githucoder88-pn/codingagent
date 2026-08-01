/**
 * CODER backend — encryption key manager.
 *
 * - Master key: 32 random bytes, stored in the server directory (0600) or
 *   provided via CODER_MASTER_KEY. Never stored in the database.
 * - Envelopes are versioned ("v1.iv.tag.ct"), so a key rotation archives
 *   the old key in keys.json while active rows are re-encrypted with the
 *   new key. Old envelopes still decrypt after rotation (archived key).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  decryptSecret,
  encryptSecret,
  envelopeVersion,
  masterKeyFromHex,
  newMasterKeyHex,
} from "../../../shared/src/index.js";

interface KeyVersionsFile {
  active: string;
  versions: Record<string, { keyHex: string; createdAt: string }>;
}

export class KeyManager {
  private activeVersion = "v1";
  private readonly versions = new Map<string, Buffer>();

  constructor(
    private readonly keysDir: string,
    private readonly envKeyHex?: string,
  ) {}

  private versionsFile(): string {
    return join(this.keysDir, "keys.json");
  }

  /** Load (or create) the master key material. Idempotent. */
  load(): void {
    if (this.envKeyHex) {
      this.versions.set("env", masterKeyFromHex(this.envKeyHex));
      this.activeVersion = "env";
      return;
    }
    const file = this.versionsFile();
    let data: KeyVersionsFile;
    if (existsSync(file)) {
      data = JSON.parse(readFileSync(file, "utf8")) as KeyVersionsFile;
    } else {
      const keyHex = newMasterKeyHex();
      data = { active: "v1", versions: { v1: { keyHex, createdAt: new Date().toISOString() } } };
      mkdirSync(this.keysDir, { recursive: true });
      writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    }
    for (const [version, entry] of Object.entries(data.versions)) {
      this.versions.set(version, masterKeyFromHex(entry.keyHex));
    }
    this.activeVersion = data.active;
  }

  get activeVersionId(): string {
    return this.activeVersion;
  }

  encrypt(plaintext: string): string {
    const key = this.versions.get(this.activeVersion);
    if (!key) throw new Error(`no active encryption key (${this.activeVersion})`);
    return encryptSecret(key, plaintext, this.activeVersion);
  }

  decrypt(envelope: string): string {
    const version = envelopeVersion(envelope);
    const key = this.versions.get(version);
    if (!key) throw new Error(`no key available for envelope version "${version}"`);
    return decryptSecret(key, envelope);
  }

  /**
   * Rotate the master key: generate a new active key, archive the previous
   * one, then run the caller's re-encryption pass (all stored provider
   * keys get decrypted with the archived key and re-encrypted with the new
   * active key). Returns how many records were re-encrypted.
   */
  rotate(reencrypt: () => number): number {
    if (this.envKeyHex) {
      throw new Error("rotation is disabled while CODER_MASTER_KEY is set via environment");
    }
    const file = this.versionsFile();
    const data: KeyVersionsFile = JSON.parse(readFileSync(file, "utf8")) as KeyVersionsFile;
    const nextVersion = `v${Object.keys(data.versions).length + 1}`;
    data.versions[nextVersion] = { keyHex: newMasterKeyHex(), createdAt: new Date().toISOString() };
    data.active = nextVersion;

    // Archive the new key FIRST so decrypt() still works for old envelopes.
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    this.versions.set(nextVersion, masterKeyFromHex(data.versions[nextVersion]!.keyHex));
    this.activeVersion = nextVersion;

    return reencrypt();
  }
}
