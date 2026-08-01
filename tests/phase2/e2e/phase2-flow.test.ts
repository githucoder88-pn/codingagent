/**
 * Phase 2 e2e: spawn the built CLI and backend as real processes and walk
 * the Phase 2 exit example plus the full lifecycle (server start/stop,
 * dashboard, admin, export, delete-account). Requires `npm run build`
 * (the test:e2e script builds first).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(process.cwd(), "dist/cli.js");
const SERVER = resolve(process.cwd(), "dist/server.js");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], env: Record<string, string> = {}): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code: code ?? -1, stdout, stderr }));
  });
}

let home = "";
let port = 0;
let serverPid: number | null = null;

function env(): Record<string, string> {
  return { CODER_HOME: home, CODER_API_PORT: String(port), CODER_API_URL: `http://127.0.0.1:${port}` };
}

function freePort(): number {
  return 18_000 + Math.floor(Math.random() * 4_000);
}

beforeAll(async () => {
  if (!existsSync(CLI) || !existsSync(SERVER)) {
    throw new Error("dist missing — run `npm run build` before e2e tests");
  }
  home = mkdtempSync(join(tmpdir(), "coder-p2e2-"));
  port = freePort();

  // Boot the backend detached.
  const child = spawn(process.execPath, [SERVER], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, CODER_HOME: home, CODER_API_PORT: String(port) },
  });
  child.unref();
  serverPid = child.pid ?? null;
  // Wait for health.
  const deadline = Date.now() + 10_000;
  for (;;) {
    const res = spawnSync("sh", ["-c", `curl -s http://127.0.0.1:${port}/api/health`], { encoding: "utf8" });
    if (res.stdout.includes("ok")) break;
    if (Date.now() > deadline) throw new Error("backend did not become healthy");
    await new Promise((r) => setTimeout(r, 250));
  }
});

afterAll(() => {
  if (serverPid) {
    try {
      process.kill(serverPid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  rmSync(home, { recursive: true, force: true });
});

describe("Phase 2 exit example (spawned binaries)", () => {
  it("coder login → auth add → settings privacy → ask → feedback → dashboard", async () => {
    // signup (prep — the exit example assumes an account exists)
    const signup = await run(["signup", "--email", "demo@coder.dev", "--password", "password123"], env());
    expect(signup.code).toBe(0);

    // 1. login
    const login = await run(["login", "--email", "demo@coder.dev", "--password", "password123"], env());
    expect(login.code).toBe(0);
    expect(login.stdout).toContain("Signed in as demo@coder.dev");

    // 2. auth add openrouter (key stored encrypted + synced)
    const authAdd = await run(["auth", "add", "openrouter", "--key", "sk-or-e2e-1234567890"], env());
    expect(authAdd.code).toBe(0);
    expect(authAdd.stdout).toContain("Key synced to the backend (encrypted)");
    const vaultRaw = readFileSync(join(home, "vault.json"), "utf8");
    expect(vaultRaw).not.toContain("sk-or-e2e-1234567890");

    // 3. settings privacy on
    const privacy = await run(["settings", "privacy", "on"], env());
    expect(privacy.code).toBe(0);
    expect(privacy.stdout).toContain("Privacy mode enabled");

    // 4. ask (with the offline mock provider so it works without network)
    await run(["provider", "use", "mock"], env());
    const ask = await run(["ask", "Build a Todo app."], env());
    expect(ask.code).toBe(0);
    expect(ask.stdout).toContain("Build a Todo app");

    // 5. feedback 5 "Worked well" (feedback-only mode — history is off)
    const feedback = await run(["feedback", "5", "Worked well"], env());
    expect(feedback.code).toBe(0);
    expect(feedback.stdout).toContain("Feedback recorded (5/5 — Worked well)");
    expect(readFileSync(join(home, "records.json"), "utf8")).toContain("Worked well");

    // 6. dashboard (headless — must not need a browser)
    const dashboard = await run(["dashboard", "--no-open"], env());
    expect(dashboard.code).toBe(0);
    expect(dashboard.stdout).toContain("CODER Dashboard");
  });

  it("sync, history and privacy round-trip", async () => {
    // Turn history back on and verify a recorded ask reaches the backend.
    await run(["settings", "privacy", "off"], env());
    await run(["ask", "Second prompt"], env());
    const history = await run(["history", "--remote"], env());
    expect(history.code).toBe(0);
    expect(history.stdout).toContain("Second prompt");

    // Offline-tolerant: point at a dead port, ask, then sync back.
    const dead = { CODER_HOME: home, CODER_API_PORT: String(port), CODER_API_URL: "http://127.0.0.1:59999" };
    const offlineAsk = await run(["ask", "Offline prompt"], dead);
    expect(offlineAsk.code).toBe(0);
    const sync = await run(["sync"], env());
    expect(sync.code).toBe(0);
    expect(sync.stdout).toContain("record(s) pushed");
    const remoteAfter = await run(["history", "--remote"], env());
    expect(remoteAfter.stdout).toContain("Offline prompt");
  });

  it("admin commands work for an admin account", async () => {
    // Seed an admin by restarting the backend with env vars.
    if (serverPid) {
      try {
        process.kill(serverPid, "SIGTERM");
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    const child = spawn(process.execPath, [SERVER], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        CODER_HOME: home,
        CODER_API_PORT: String(port),
        CODER_ADMIN_EMAIL: "boss@coder.dev",
        CODER_ADMIN_PASSWORD: "adminpass123",
        CODER_ADMIN_SUPERADMIN: "1",
      },
    });
    child.unref();
    serverPid = child.pid ?? null;
    const deadline = Date.now() + 10_000;
    for (;;) {
      const res = spawnSync("sh", ["-c", `curl -s http://127.0.0.1:${port}/api/health`], { encoding: "utf8" });
      if (res.stdout.includes("ok")) break;
      if (Date.now() > deadline) throw new Error("backend did not become healthy");
      await new Promise((r) => setTimeout(r, 250));
    }

    await run(["logout"], env());
    const login = await run(["login", "--email", "boss@coder.dev", "--password", "adminpass123"], env());
    expect(login.code).toBe(0);

    const users = await run(["admin", "users"], env());
    expect(users.code).toBe(0);
    expect(users.stdout).toContain("demo@coder.dev");

    const usage = await run(["admin", "usage"], env());
    expect(usage.code).toBe(0);
    expect(usage.stdout).toContain("Usage");

    const rotate = await run(["admin", "rotate-key", "--yes"], env());
    expect(rotate.code).toBe(0);
    expect(rotate.stdout).toContain("Master key rotated");

    // Key still usable after rotation.
    const list = await run(["auth", "list"], env());
    expect(list.code).toBe(0);
    expect(list.stdout).toContain("openrouter");
  });

  it("exports and deletes the account", async () => {
    const outFile = join(home, "e2e-export.json");
    const exp = await run(["export", "--out", outFile], env());
    expect(exp.code).toBe(0);
    const bundle = JSON.parse(readFileSync(outFile, "utf8")) as { account: { email: string }; records: unknown[] };
    expect(bundle.account.email).toBe("boss@coder.dev");
    expect(bundle.records.length).toBeGreaterThan(0);

    const del = await run(["delete-account", "--yes"], env());
    expect(del.code).toBe(0);
    expect(del.stdout).toContain("Account deleted");
    expect(existsSync(join(home, "session.json"))).toBe(false);
  });
});

describe("coder server lifecycle (spawned)", () => {
  it("start → status → stop", async () => {
    const lifecyclePort = freePort();
    const lifecycleEnv = { CODER_HOME: home, CODER_API_PORT: String(lifecyclePort) };

    const statusBefore = await run(["server", "status"], lifecycleEnv);
    expect(statusBefore.code).toBe(0);
    expect(statusBefore.stdout).toContain("not running");

    const start = await run(["server", "start"], lifecycleEnv);
    expect(start.code).toBe(0);
    expect(start.stdout).toContain("Backend started");

    const statusAfter = await run(["server", "status"], lifecycleEnv);
    expect(statusAfter.stdout).toContain("Backend running");

    // Health via the spawned server.
    const health = spawnSync("sh", ["-c", `curl -s http://127.0.0.1:${lifecyclePort}/api/health`], { encoding: "utf8" });
    expect(health.stdout).toContain("ok");

    const stop = await run(["server", "stop"], lifecycleEnv);
    expect(stop.code).toBe(0);
    expect(stop.stdout).toContain("Backend stopped");

    const statusFinal = await run(["server", "status"], lifecycleEnv);
    expect(statusFinal.stdout).toContain("not running");
  });
});
