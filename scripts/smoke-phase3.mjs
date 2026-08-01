#!/usr/bin/env node
/**
 * CODER Phase 3 smoke test.
 *
 * Builds everything, then walks the Phase 3 exit condition in a temp git
 * repository with the offline mock provider:
 *   analyze → modify → test → commit, plus scan/search/explain/context,
 *   checkpoints and undo/redo. Exits non-zero on any failure.
 *
 *   node scripts/smoke-phase3.mjs
 */

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = resolve(root, "dist", "cli.js");

function run(args, env = {}, cwd) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    cwd,
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

// 2. Fresh home + temp git repo
const home = mkdtempSync(join(tmpdir(), "coder-smoke3-"));
const repo = mkdtempSync(join(tmpdir(), "coder-smoke3-repo-"));
cpSync(join(root, "tests", "fixtures", "sample-repo"), repo, { recursive: true });
spawnSync("git", ["init", "-q"], { cwd: repo });
spawnSync("git", ["config", "user.email", "smoke@coder.dev"], { cwd: repo });
spawnSync("git", ["config", "user.name", "Smoke"], { cwd: repo });
spawnSync("git", ["add", "-A"], { cwd: repo });
spawnSync("git", ["commit", "-qm", "init"], { cwd: repo });

const env = { CODER_HOME: home, CODER_PROVIDER: "mock", CODER_MODEL: "mock/coder-1" };
let failures = 0;

try {
  console.log("Smoke testing the Phase 3 exit condition:\n");

  failures += check("scan", run(["scan", "--dir", repo], env).stdout.includes("Source files"));
  failures += check("search definition", run(["search", "authenticate", "--dir", repo, "--kind", "definition"], env).stdout.includes("src/auth.ts"));
  failures += check("search content", run(["search", "AuthService", "--dir", repo], env).stdout.includes("src/auth.ts"));
  failures += check("files", run(["files", "--dir", repo], env).stdout.includes("src/index.ts"));
  failures += check("context", run(["context", "--dir", repo], env).stdout.includes("# Repository context"));
  failures += check("explain", run(["explain", "src/auth.ts", "--dir", repo], env).stdout.includes("AuthService"));

  console.log("\nAgent run (analyze → modify → test → commit):\n");
  const agent = run(["agent", "Analyze the repository.", "--dir", repo, "--level", "full-auto"], env, repo);
  failures += check("agent completes", agent.code === 0 && agent.stdout.includes("Task complete"));
  failures += check("agent used tools", agent.stdout.includes("→ scan") && agent.stdout.includes("→ write_file"));
  const log = spawnSync("git", ["log", "--oneline", "-1"], { cwd: repo, encoding: "utf8" });
  failures += check("agent committed", log.stdout.includes("chore: agent changes"));

  console.log("\nRollback + checkpoints:\n");
  failures += check("diff shows edit", run(["diff", "--dir", repo], env).stdout.includes("AGENT.md"));
  failures += check("undo", run(["undo", "--dir", repo], env).stdout.includes("Undid"));
  failures += check("checkpoints create", run(["checkpoints", "create", "--dir", repo, "--name", "smoke"], env).stdout.includes("Checkpoint created"));
  failures += check("checkpoints list", run(["checkpoints", "--dir", repo], env).stdout.includes("smoke-"));

  console.log("\nPermission levels:\n");
  const safeAgent = run(["agent", "Add auth.", "--dir", repo, "--level", "safe"], env, repo);
  failures += check("safe level denies writes", safeAgent.stdout.includes("Permission denied"));

  console.log("");
  if (failures === 0) {
    console.log("Phase 3 smoke test passed. ✓");
  } else {
    console.error(`Phase 3 smoke test failed with ${failures} problem(s).`);
  }
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
