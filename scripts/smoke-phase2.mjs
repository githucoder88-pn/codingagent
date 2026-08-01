#!/usr/bin/env node
/**
 * CODER Phase 2 smoke test.
 *
 * Builds everything, starts the backend, then walks the Phase 2 exit
 * example plus the control-plane lifecycle against the offline `mock`
 * provider in a throwaway CODER_HOME. Exits non-zero on any failure.
 *
 *   node scripts/smoke-phase2.mjs
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = resolve(root, "dist", "cli.js");

function run(args, env = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { code: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

function check(name, condition, extra = "") {
  if (condition) {
    console.log(`  ✓ ${name}`);
    return 0;
  }
  console.error(`  ✗ ${name}${extra ? `\n    ${extra}` : ""}`);
  return 1;
}

// 1. Build
console.log("Building…");
execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });

// 2. Fresh home + backend
const home = mkdtempSync(join(tmpdir(), "coder-smoke2-"));
const port = 18_800 + Math.floor(Math.random() * 1000);
const env = { CODER_HOME: home, CODER_API_PORT: String(port), CODER_API_URL: `http://127.0.0.1:${port}` };
let failures = 0;

const server = spawn(process.execPath, [resolve(root, "dist", "server.js")], {
  env: { ...process.env, CODER_HOME: home, CODER_API_PORT: String(port) },
  detached: true,
  stdio: "ignore",
});
server.unref();
const serverPid = server.pid;

try {
  // Wait for health.
  const deadline = Date.now() + 10_000;
  for (;;) {
    const health = spawnSync("sh", ["-c", `curl -s http://127.0.0.1:${port}/api/health`], { encoding: "utf8" });
    if (health.stdout.includes("ok")) break;
    if (Date.now() > deadline) {
      failures += 1;
      console.error("  ✗ backend did not become healthy");
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log("Smoke testing the Phase 2 exit example:\n");

  failures += check("signup", run(["signup", "--email", "smoke@coder.dev", "--password", "password123"], env).code === 0);
  failures += check("login", run(["login", "--email", "smoke@coder.dev", "--password", "password123"], env).stdout.includes("Signed in"));
  failures += check(
    "auth add openrouter (encrypted + synced)",
    run(["auth", "add", "openrouter", "--key", "sk-or-smoke-1234567890"], env).stdout.includes("Key synced"),
  );
  const vaultRaw = readFileSync(join(home, "vault.json"), "utf8");
  failures += check("local vault encrypted", !vaultRaw.includes("sk-or-smoke-1234567890"));
  failures += check("settings privacy on", run(["settings", "privacy", "on"], env).stdout.includes("Privacy mode enabled"));
  run(["provider", "use", "mock"], env);
  failures += check("ask works", run(["ask", "Build a Todo app."], env).stdout.includes("Build a Todo app"));
  failures += check(
    "feedback 5",
    run(["feedback", "5", "Worked well"], env).stdout.includes("Feedback recorded (5/5 — Worked well)"),
  );
  failures += check("dashboard (headless)", run(["dashboard", "--no-open"], env).stdout.includes("CODER Dashboard"));
  failures += check("history --remote", run(["history", "--remote"], env).code === 0);

  console.log("\nSmoke testing privacy + sync:\n");
  run(["settings", "privacy", "off"], env);
  run(["ask", "Sync me"], env);
  const offline = run(["ask", "Offline one"], { ...env, CODER_API_URL: "http://127.0.0.1:59999" });
  failures += check("offline ask still works", offline.code === 0);
  failures += check("coder sync", run(["sync"], env).stdout.includes("record(s) pushed"));
  failures += check("export", run(["export", "--out", join(home, "export.json")], env).code === 0);

  console.log("\nSmoke testing server lifecycle:\n");
  const lcPort = port + 1;
  const lcEnv = { CODER_HOME: home, CODER_API_PORT: String(lcPort) };
  failures += check("server start", run(["server", "start"], lcEnv).stdout.includes("Backend started"));
  failures += check("server status", run(["server", "status"], lcEnv).stdout.includes("Backend running"));
  failures += check("server stop", run(["server", "stop"], lcEnv).stdout.includes("Backend stopped"));

  console.log("");
  if (failures === 0) {
    console.log("Phase 2 smoke test passed. ✓");
  } else {
    console.error(`Phase 2 smoke test failed with ${failures} problem(s).`);
  }
} finally {
  if (serverPid) {
    try {
      process.kill(serverPid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  rmSync(home, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
