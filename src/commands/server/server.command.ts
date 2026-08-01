/**
 * CODER — `coder server` commands.
 *
 * Lifecycle management for the local CODER control plane:
 *   start   — spawn the backend (detached) and wait until it is healthy
 *   status  — report health + pid
 *   stop    — terminate the backend
 *
 * The backend is the bundled dist/server.js when available, otherwise the
 * backend sources via tsx (development).
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { API_DEFAULT_PORT } from "../../../shared/src/index.js";
import { paths } from "../../utils/paths.js";
import { isTty } from "../../utils/tty.js";
import { NetworkError } from "../../core/errors/index.js";
import type { AppContext } from "../../core/application/application.js";
import type { ServerHealth } from "../../account/types.js";

const PID_FILE = "server.pid";

function serverPidFile(): string {
  return join(paths.serverDir(), PID_FILE);
}

function resolveServerEntry(): string {
  // Walk up from this module to the package root (works both when bundled
  // into dist/cli.js and when running from source via tsx).
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    const bundled = resolve(dir, "dist", "server.js");
    if (existsSync(bundled)) return bundled;
    const dev = resolve(dir, "backend", "src", "index.ts");
    if (existsSync(dev)) return dev;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot locate the backend entry point (dist/server.js or backend/src/index.ts).");
}

export interface ServerOptions {
  port?: number;
  foreground?: boolean;
}

export async function serverStatus(ctx: AppContext, port: number): Promise<ServerHealth> {
  const url = `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(`${url}/api/health`);
    if (res.ok) {
      const body = (await res.json()) as { ok?: boolean; version?: string };
      return { ok: true, version: body.version };
    }
    return { ok: false, error: `HTTP ${res.status}` };
  } catch {
    return { ok: false, error: "not running" };
  }
}

export async function serverStartCommand(ctx: AppContext, opts: ServerOptions = {}): Promise<number> {
  const { theme } = ctx;
  const port = opts.port ?? Number(process.env.CODER_API_PORT ?? API_DEFAULT_PORT);
  const existing = await serverStatus(ctx, port);
  if (existing.ok) {
    process.stdout.write(`${theme.success}Backend already running on http://127.0.0.1:${port} (v${existing.version ?? "?"}).${theme.reset}\n`);
    return 0;
  }

  const entry = resolveServerEntry();
  const args = opts.foreground ? [entry] : [entry];
  const logFile = join(paths.serverDir(), "server.log");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(paths.serverDir(), { recursive: true });

  process.stdout.write(`${theme.dim}Starting backend (${entry}) on port ${port}…${theme.reset}\n`);

  if (opts.foreground) {
    const child = spawn(process.execPath, args, {
      stdio: "inherit",
      env: { ...process.env, CODER_API_PORT: String(port) },
    });
    child.on("exit", (code) => process.exit(code ?? 0));
    return 0;
  }

  const { appendFileSync } = await import("node:fs");
  appendFileSync(logFile, `--- server start ${new Date().toISOString()} ---\n`);
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env, CODER_API_PORT: String(port) },
  });
  child.unref();
  writeFileSync(serverPidFile(), String(child.pid ?? ""));

  // Wait for health (up to ~10 s).
  const deadline = Date.now() + 10_000;
  for (;;) {
    const health = await serverStatus(ctx, port);
    if (health.ok) {
      process.stdout.write(
        `${theme.success}Backend started on http://127.0.0.1:${port} (pid ${child.pid}).${theme.reset}\n`,
      );
      process.stdout.write(`${theme.dim}Dashboard: http://127.0.0.1:${port} · Logs: ${logFile}${theme.reset}\n`);
      return 0;
    }
    if (Date.now() > deadline) {
      throw new NetworkError(
        `Backend did not become healthy within 10s. Check the log: ${logFile}`,
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function serverStatusCommand(ctx: AppContext, port: number): Promise<number> {
  const { theme } = ctx;
  const health = await serverStatus(ctx, port);
  const pid = existsSync(serverPidFile()) ? readFileSync(serverPidFile(), "utf8").trim() : undefined;
  if (health.ok) {
    process.stdout.write(
      `${theme.success}Backend running: http://127.0.0.1:${port} (v${health.version ?? "?"})${pid ? ` · pid ${pid}` : ""}${theme.reset}\n`,
    );
  } else {
    process.stdout.write(`${theme.dim}Backend not running on http://127.0.0.1:${port}. Start it with \`coder server start\`.${theme.reset}\n`);
  }
  return 0;
}

export async function serverStopCommand(ctx: AppContext, port: number): Promise<number> {
  const { theme } = ctx;
  const health = await serverStatus(ctx, port);
  if (!health.ok) {
    process.stdout.write(`${theme.dim}Backend is not running on port ${port}.${theme.reset}\n`);
    rmSync(serverPidFile(), { force: true });
    return 0;
  }
  // Prefer the recorded pid; fall back to a graceful /api/health-less kill.
  const pid = existsSync(serverPidFile()) ? Number(readFileSync(serverPidFile(), "utf8").trim()) : NaN;
  if (Number.isFinite(pid) && pid > 0) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
    const deadline = Date.now() + 5000;
    for (;;) {
      if (!(await serverStatus(ctx, port)).ok) break;
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  } else {
    // No pid recorded: ask the OS for the listener on this port (POSIX).
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync("sh", ["-c", `lsof -ti tcp:${port} | xargs -r kill`]);
    void result;
  }
  rmSync(serverPidFile(), { force: true });
  const after = await serverStatus(ctx, port);
  process.stdout.write(
    after.ok
      ? `${theme.warning}Backend still running on port ${port}.${theme.reset}\n`
      : `${theme.success}Backend stopped.${theme.reset}\n`,
  );
  return 0;
}

export function serverIsInteractive(): boolean {
  return isTty(process.stdout);
}
