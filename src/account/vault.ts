/**
 * CODER CLI — encrypted local key vault (Phase 2).
 *
 * Provider API keys are now encrypted at rest with AES-256-GCM before
 * touching disk (~/.coder/vault.json). The master key is auto-generated
 * into ~/.coder/keys/master.key (0600) — it never lives in the vault.
 *
 * Migration: a legacy plaintext ~/.coder/providers.json (Phase 1 format)
 * is encrypted on first use and then renamed to providers.json.migrated.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { encryptSecret, decryptSecret, masterKeyFromHex, newMasterKeyHex } from "../../shared/src/index.js";
import { paths, readJson, writeJson, atomicWriteFile } from "../utils/paths.js";
import { ConfigError } from "../core/errors/index.js";
import type { ProviderAccount } from "../types/index.js";

const vaultSchema = z.record(
  z.string().min(1),
  z
    .object({
      apiKey: z.string().min(1),
      baseUrl: z.string().url().optional(),
      configuredAt: z.string(),
      remoteFingerprint: z.string().optional(),
      syncedAt: z.string().optional(),
    })
    .strict(),
);

type VaultFile = z.infer<typeof vaultSchema>;

function masterKeyPath(): string {
  return join(paths.root(), "keys", "master.key");
}

function loadMasterKey(): Buffer {
  const path = masterKeyPath();
  if (existsSync(path)) {
    return masterKeyFromHex(readFileSync(path, "utf8").trim());
  }
  const hex = newMasterKeyHex();
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${hex}\n`, { mode: 0o600 });
  return masterKeyFromHex(hex);
}

function vaultPath(): string {
  return paths.vault();
}

function readVault(key: Buffer): VaultFile {
  if (!existsSync(vaultPath())) return {};
  let raw: string;
  try {
    raw = readFileSync(vaultPath(), "utf8");
  } catch {
    return {};
  }
  if (raw.trim() === "") return {};
  let decrypted: string;
  try {
    decrypted = decryptSecret(key, raw.trim());
  } catch {
    throw new ConfigError(
      `Cannot decrypt ${vaultPath()} — the master key in ${masterKeyPath()} may have changed.`,
    );
  }
  const parsed = vaultSchema.safeParse(JSON.parse(decrypted));
  if (!parsed.success) return {};
  return parsed.data;
}

function writeVault(key: Buffer, vault: VaultFile): void {
  const encrypted = encryptSecret(key, JSON.stringify(vault));
  atomicWriteFile(vaultPath(), encrypted, { mode: 0o600 });
}

/** Migrate a legacy plaintext providers.json into the encrypted vault. */
function migrateLegacy(key: Buffer): void {
  const legacy = paths.providers();
  if (!existsSync(legacy)) return;
  const raw = readJson<Record<string, { apiKey?: string; baseUrl?: string; configuredAt?: string }>>(legacy);
  if (raw) {
    const vault: VaultFile = {};
    for (const [provider, account] of Object.entries(raw)) {
      if (account.apiKey) {
        vault[provider] = {
          apiKey: account.apiKey,
          ...(account.baseUrl ? { baseUrl: account.baseUrl } : {}),
          configuredAt: account.configuredAt ?? new Date().toISOString(),
        };
      }
    }
    if (Object.keys(vault).length > 0) writeVault(key, vault);
  }
  // Never leave plaintext keys on disk.
  renameSync(legacy, `${legacy}.migrated`);
}

class Vault {
  private readonly key: Buffer;

  constructor() {
    this.key = loadMasterKey();
    migrateLegacy(this.key);
  }

  getAccount(provider: string): ProviderAccount | undefined {
    const entry = readVault(this.key)[provider];
    if (!entry) return undefined;
    return {
      apiKey: entry.apiKey,
      ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}),
      configuredAt: entry.configuredAt,
      remoteFingerprint: entry.remoteFingerprint,
      syncedAt: entry.syncedAt,
    };
  }

  setAccount(provider: string, account: ProviderAccount): void {
    const vault = readVault(this.key);
    vault[provider] = {
      apiKey: account.apiKey,
      ...(account.baseUrl ? { baseUrl: account.baseUrl } : {}),
      configuredAt: account.configuredAt,
      ...(account.remoteFingerprint ? { remoteFingerprint: account.remoteFingerprint } : {}),
      ...(account.syncedAt ? { syncedAt: account.syncedAt } : {}),
    };
    writeVault(this.key, vault);
  }

  remove(provider: string): boolean {
    const vault = readVault(this.key);
    if (!(provider in vault)) return false;
    delete vault[provider];
    writeVault(this.key, vault);
    return true;
  }

  list(): Array<{ provider: string; account: ProviderAccount }> {
    return Object.entries(readVault(this.key)).map(([provider, entry]) => ({
      provider,
      account: {
        apiKey: entry.apiKey,
        ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}),
        configuredAt: entry.configuredAt,
        remoteFingerprint: entry.remoteFingerprint,
        syncedAt: entry.syncedAt,
      },
    }));
  }

  /** Clear the vault entirely (delete-account flows). */
  wipe(): void {
    rmSync(vaultPath(), { force: true });
  }
}

/**
 * The vault is stateless: every call re-reads the master key + ciphertext
 * from disk, so a fresh instance is always correct (CODER_HOME changes,
 * migrations, multi-account machines).
 */
export function vault(): Vault {
  return new Vault();
}

export { Vault };
