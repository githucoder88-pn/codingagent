/**
 * CODER — filesystem utilities.
 *
 * Path resolution for the CODER home directory (`~/.coder`, relocatable via
 * `CODER_HOME`) plus safe JSON/atomic file helpers used by config, session
 * and provider-account storage.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_CONFIG_DIR_NAME, FILES } from "../core/constants/index.js";
import { ConfigError } from "../core/errors/index.js";

/** Resolve the CODER home directory (default `~/.coder`, override `CODER_HOME`). */
export function coderHome(): string {
  const override = process.env.CODER_HOME;
  if (override && override.trim() !== "") {
    return resolve(override);
  }
  return join(homedir(), DEFAULT_CONFIG_DIR_NAME);
}

export const paths = {
  root: () => coderHome(),
  config: () => join(coderHome(), FILES.config),
  providers: () => join(coderHome(), FILES.providers),
  sessionsDir: () => join(coderHome(), FILES.sessionsDir),
  currentSession: () => join(coderHome(), FILES.currentSession),
  logsDir: () => join(coderHome(), FILES.logsDir),
  cacheDir: () => join(coderHome(), FILES.cacheDir),
  cacheDb: () => join(coderHome(), FILES.cacheDb),
  cacheJson: () => join(coderHome(), FILES.cacheJson),
  logFile: (name: string) => join(coderHome(), FILES.logsDir, name),
  // Phase 2 — account & data plane
  session: () => join(coderHome(), FILES.session),
  settings: () => join(coderHome(), FILES.settings),
  records: () => join(coderHome(), FILES.records),
  vault: () => join(coderHome(), FILES.vault),
  keysDir: () => join(coderHome(), FILES.keysDir),
  serverDir: () => join(coderHome(), FILES.serverDir),
};

/** Create the full `~/.coder` layout. Idempotent. */
export function ensureCoderDirs(): void {
  for (const dir of [
    paths.root(),
    paths.sessionsDir(),
    paths.logsDir(),
    paths.cacheDir(),
  ]) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Read + parse a JSON file. Returns `undefined` when missing or empty. */
export function readJson<T>(file: string): T | undefined {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new ConfigError(`Cannot read "${file}": ${(err as Error).message}`);
  }
  if (raw.trim() === "") return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new ConfigError(`Invalid JSON in "${file}": ${(err as Error).message}`);
  }
}

/** Atomically write a JSON file (temp file + rename). */
export function writeJson(file: string, value: unknown, opts?: { mode?: number }): void {
  atomicWriteFile(file, `${JSON.stringify(value, null, 2)}\n`, opts);
}

/** Atomic write: write to a sibling temp file, then rename over the target. */
export function atomicWriteFile(file: string, content: string, opts?: { mode?: number }): void {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, content, { mode: opts?.mode ?? 0o644 });
  try {
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** File size in bytes; `undefined` when the file does not exist. */
export function fileSize(file: string): number | undefined {
  try {
    return statSync(file).size;
  } catch {
    return undefined;
  }
}

/** True when a path exists. */
export function exists(file: string): boolean {
  try {
    statSync(file);
    return true;
  } catch {
    return false;
  }
}
