/**
 * Test helper: boot the CODER backend on an ephemeral port with a temp
 * server directory, and tear it down afterwards.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createServer, type BackendContext } from "../../backend/src/server.js";
import type { ServerConfig } from "../../backend/src/config.js";

export interface TestBackend {
  server: Server;
  ctx: BackendContext;
  url: string;
  port: number;
  close: () => Promise<void>;
}

export async function startTestBackend(overrides: Partial<ServerConfig> = {}): Promise<TestBackend> {
  const serverDir = mkdtempSync(join(tmpdir(), "coder-backend-test-"));
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0, // ephemeral
    serverDir,
    dbPath: join(serverDir, "coder.db"),
    jwtSecret: "test-jwt-secret-0123456789abcdef",
    tokenTtlSeconds: 3600,
    firebaseProjectId: undefined,
    adminEmail: undefined,
    adminPassword: undefined,
    adminSuperadmin: false,
    logFile: join(serverDir, "server.log"),
    ...overrides,
  };

  const ctx = await createServer(config);
  const server = await new Promise<Server>((resolve) => {
    const s = ctx.app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;

  return {
    server,
    ctx,
    url: `http://127.0.0.1:${port}`,
    port,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await ctx.close();
      rmSync(serverDir, { recursive: true, force: true });
    },
  };
}

/** JSON helper for API calls in tests. */
export async function api(
  backend: TestBackend,
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${backend.url}/api${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, body };
}

/** Sign up and return the token + user. */
export async function signup(backend: TestBackend, email: string, password = "password123") {
  const result = await api(backend, "/auth/signup", { method: "POST", body: { email, password } });
  if (result.status !== 201) throw new Error(`signup failed: ${JSON.stringify(result.body)}`);
  return result.body as { token: string; user: { id: string; email: string; role: string } };
}
