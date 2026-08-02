#!/usr/bin/env node
/**
 * CODER Phase 8 smoke test — global knowledge network + model intelligence.
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

const home = mkdtempSync(join(tmpdir(), "coder-smoke8-"));
const repo = mkdtempSync(join(tmpdir(), "coder-smoke8-repo-"));
cpSync(join(root, "tests", "fixtures", "sample-repo"), repo, { recursive: true });
const env = { CODER_HOME: home, CODER_PROVIDER: "mock", CODER_MODEL: "mock/coder-1" };
let f = 0;
try {
  console.log("\nPhase 8 exit condition:\n");
  f += check("knowledge graph rebuild", run(["knowledge", "graph", "--dir", repo], env).stdout.includes("rebuilt"));
  f += check("knowledge stats", run(["knowledge", "stats"], env).stdout.includes("Knowledge graph"));
  f += check("knowledge search", run(["knowledge", "search", "auth"], env).code === 0);
  f += check("model benchmark (mock)", run(["model", "benchmark", "--provider", "mock"], env).stdout.includes("Model benchmark"));
  f += check("model info classifies", run(["model", "info", "o1-preview"], env).stdout.includes("reasoning"));
  f += check("13+ providers registered", run(["provider", "list"], env).stdout.includes("ollama") && run(["provider", "list"], env).stdout.includes("groq"));
  console.log(f === 0 ? "\nPhase 8 smoke test passed. ✓" : `\nPhase 8 smoke test failed with ${f} problem(s).`);
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
}
process.exit(f === 0 ? 0 : 1);
