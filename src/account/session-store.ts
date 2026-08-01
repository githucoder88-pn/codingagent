/**
 * CODER CLI — account session store.
 *
 * Persists the signed-in session to ~/.coder/session.json (0600): the API
 * token plus cached user info. `coder login` writes it, `coder logout`
 * removes it.
 */

import { rmSync } from "node:fs";
import { accountSessionSchema } from "../../shared/src/index.js";
import { paths, readJson, writeJson, exists } from "../utils/paths.js";
import type { AccountSession } from "./types.js";
import { AuthError } from "../core/errors/index.js";

export function sessionPath(): string {
  return paths.session();
}

export function loadSession(): AccountSession | undefined {
  const raw = readJson<unknown>(sessionPath());
  if (raw === undefined) return undefined;
  const parsed = accountSessionSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  return parsed.data;
}

export function saveSession(session: AccountSession): void {
  writeJson(sessionPath(), session, { mode: 0o600 });
}

export function clearSession(): void {
  rmSync(sessionPath(), { force: true });
}

export function requireSession(): AccountSession {
  const session = loadSession();
  if (!session) {
    throw new AuthError("Not signed in. Run `coder login` first.");
  }
  return session;
}

export function sessionExists(): boolean {
  return exists(sessionPath());
}
