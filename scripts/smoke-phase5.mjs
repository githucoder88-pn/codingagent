#!/usr/bin/env node
/**
 * CODER Phase 5 smoke test — cognitive core, distributed worker, memory
 * scopes, run --mode. Offline mock provider.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = resolve(root, "dist", "cli.js");
const run = (args, env, cwd) => { const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env }, cwd }); return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }; };
const check = (name, cond) => (cond ? (console.log(`  ✓ ${name}`), 0) : (console.error(`  ✗ ${name}`), 1));

console.log("Building…");
execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });

const home = mkdtempSync(join(tmpdir(), "coder-smoke5-"));
const repo = mkdtempSync(join(tmpdir(), "coder-smoke5-repo-"));
cpSync(join(root, "tests", "fixtures", "sample-repo"), repo, { recursive: true });
const env = { CODER_HOME: home, CODER_PROVIDER: "mock", CODER_MODEL: "mock/coder-1" };
let f = 0;
try {
  console.log("\nPhase 5 exit condition:\n");
  f += check("cognitive status", run(["cognitive", "status"], env).stdout.includes("Cognitive core"));
  f += check("worker registers", run(["worker", "--name", "n1", "--type", "agent", "--region", "us"], env).stdout.includes("Registered"));
  f += check("cluster status", run(["cluster", "status"], env).stdout.includes("Cluster"));
  f += check("memory store session/immediate", run(["memory", "store", "k", "v", "--scope", "immediate"], env).stdout.includes("[session]"));
  f += check("memory store working (project)", run(["memory", "store", "dec", "use tabs", "--scope", "working"], env).stdout.includes("[project]"));
  f += check("memory recall", run(["memory", "recall", "dec"], env).stdout.includes("use tabs"));
  f += check("run --mode local", run(["run", "summarize", "--dir", repo, "--mode", "local"], env).stdout.includes("Result"));
  console.log(f === 0 ? "\nPhase 5 smoke test passed. ✓" : `\nPhase 5 smoke test failed with ${f} problem(s).`);
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
}
process.exit(f === 0 ? 0 : 1);
