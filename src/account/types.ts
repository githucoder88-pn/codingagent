/**
 * CODER CLI — account types (Phase 2).
 */

import type { PublicUser, Role } from "../../shared/src/index.js";

export interface AccountSession {
  token: string;
  user: { id: string; email: string; role: Role };
  serverUrl: string;
  loggedInAt: string;
}

export interface RemoteKeyInfo {
  provider: string;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerHealth {
  ok: boolean;
  version?: string;
  error?: string;
}

export type { PublicUser };
