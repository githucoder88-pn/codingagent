#!/usr/bin/env node
/**
 * CODER smoke test.
 *
 * Builds the CLI and exercises the Phase 1 exit-criteria flow against the
 * offline `mock` provider in a throwaway CODER_HOME. Exits non-zero on any
 * failure. Used by CI and before releases.
 *
 *   node scripts/smoke.mjs
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
    return true;
  }
  console.error(`  ✗ ${name}${extra ? `\n    ${extra}` : ""}`);
  return false;
}

// 1. Build
console.log("Building…");
execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });

// 2. Fresh home
const home = mkdtempSync(join(tmpdir(), "coder-smoke-"));
const env = { CODER_HOME: home };
let failures = 0;

try {
  console.log("Smoke testing the Phase 1 exit-criteria flow (mock provider):\n");

  failures += check("version", run(["--version"], env).stdout.trim() === "0.3.0") ? 0 : 1;
  failures += check("help renders", run(["help"], env).stdout.includes("Usage: coder")) ? 0 : 1;

  const providerUse = run(["provider", "use", "mock"], env);
  failures += check("provider use mock", providerUse.code === 0 && providerUse.stdout.includes("Active provider")) ? 0 : 1;

  const models = run(["models"], env);
  failures += check("models lists catalogue", models.code === 0 && models.stdout.includes("mock/coder-1")) ? 0 : 1;

  const modelUse = run(["model", "use", "mock/coder-2"], env);
  failures += check("model use mock/coder-2", modelUse.code === 0 && modelUse.stdout.includes("mock/coder-2")) ? 0 : 1;

  const modelCurrent = run(["model", "current"], env);
  failures += check("model current", modelCurrent.stdout.trim().startsWith("mock/coder-2")) ? 0 : 1;

  const ask = run(["ask", "Build a Todo application."], env);
  failures += check(
    "ask streams a reply",
    ask.code === 0 && ask.stdout.includes("Build a Todo application"),
    ask.stderr,
  ) ? 0 : 1;

  const sessions = run(["sessions", "list"], env);
  failures += check("session persisted", sessions.stdout.includes("session-001")) ? 0 : 1;

  const clear = run(["clear"], env);
  failures += check("clear resets session", clear.code === 0) ? 0 : 1;

  const layout = run(["config", "path"], env);
  failures += check("config path", layout.code === 0 && layout.stdout.trim() === join(home, "config.json")) ? 0 : 1;

  const unconfigured = run(["ask", "--provider", "openai", "hi"], env);
  failures += check("unconfigured provider exits 3", unconfigured.code === 3) ? 0 : 1;

  const unknown = run(["nope"], env);
  failures += check("unknown command exits 2", unknown.code === 2) ? 0 : 1;

  console.log("");
  if (failures === 0) {
    console.log("Smoke test passed. ✓");
  } else {
    console.error(`Smoke test failed with ${failures} problem(s).`);
  }
} finally {
  rmSync(home, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
