/**
 * CODER backend — configuration.
 *
 * All settings come from environment variables (with sensible local
 * defaults). Secrets (master key, JWT secret) are auto-generated into the
 * server directory when not provided, so a fresh install is secure by
 * default.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { coderHome } from "../../src/utils/paths.js";
import { API_DEFAULT_HOST, API_DEFAULT_PORT, newMasterKeyHex } from "../../shared/src/index.js";

// Re-exported so tests can point the KeyManager at temp dirs.
export { readOrCreate };

export interface ServerConfig {
  host: string;
  port: number;
  /** Directory for the SQLite db, master key, jwt secret and logs. */
  serverDir: string;
  dbPath: string;
  /** Master key from the environment (optional — KeyManager manages one otherwise). */
  masterKeyHex?: string;
  jwtSecret: string;
  tokenTtlSeconds: number;
  /** Optional Firebase Auth project id (token verification enabled when set). */
  firebaseProjectId?: string;
  /** Seed an admin account at boot (email:password). */
  adminEmail?: string;
  adminPassword?: string;
  /** Seed the account as superadmin (enables key rotation). */
  adminSuperadmin?: boolean;
  logFile: string;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

function readOrCreate(file: string, generate: () => string): string {
  try {
    if (existsSync(file)) {
      const existing = readFileSync(file, "utf8").trim();
      if (existing) return existing;
    }
    const value = generate();
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, `${value}\n`, { mode: 0o600 });
    return value;
  } catch (err) {
    throw new Error(`Cannot read/create secret file ${file}: ${(err as Error).message}`);
  }
}

export function loadConfig(): ServerConfig {
  const serverDir = env("CODER_SERVER_DIR") ?? join(coderHome(), "server");
  mkdirSync(serverDir, { recursive: true });

  // Master key: from the environment (rotation disabled) or managed by the
  // KeyManager via keys.json (rotatable). Never stored in the database.
  const masterKeyHex = env("CODER_MASTER_KEY");
  const jwtSecret =
    env("CODER_JWT_SECRET") ?? readOrCreate(join(serverDir, "jwt.secret"), () => newMasterKeyHex());

  const adminEmail = env("CODER_ADMIN_EMAIL");
  const adminPassword = env("CODER_ADMIN_PASSWORD");
  if (adminEmail && !adminPassword) {
    throw new Error("CODER_ADMIN_EMAIL set without CODER_ADMIN_PASSWORD");
  }

  return {
    host: env("CODER_API_HOST") ?? API_DEFAULT_HOST,
    port: Number(env("CODER_API_PORT") ?? API_DEFAULT_PORT),
    serverDir,
    dbPath: env("CODER_DB_PATH") ?? join(serverDir, "coder.db"),
    masterKeyHex,
    jwtSecret,
    tokenTtlSeconds: Number(env("CODER_TOKEN_TTL_SEC") ?? 7 * 24 * 60 * 60),
    firebaseProjectId: env("CODER_FIREBASE_PROJECT_ID"),
    adminEmail,
    adminPassword,
    adminSuperadmin: env("CODER_ADMIN_SUPERADMIN") === "1",
    logFile: join(serverDir, "server.log"),
  };
}
