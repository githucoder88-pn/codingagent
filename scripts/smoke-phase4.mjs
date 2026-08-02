#!/usr/bin/env node
/**
 * CODER Phase 4 smoke test — multi-agent orchestration, MCP, extensions,
 * skills, tasks, workflows. Offline mock provider, fresh CODER_HOME.
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

const home = mkdtempSync(join(tmpdir(), "coder-smoke4-"));
const repo = mkdtempSync(join(tmpdir(), "coder-smoke4-repo-"));
cpSync(join(root, "tests", "fixtures", "sample-repo"), repo, { recursive: true });
const env = { CODER_HOME: home, CODER_PROVIDER: "mock", CODER_MODEL: "mock/coder-1" };
let f = 0;
try {
  console.log("\nPhase 4 exit condition:\n");
  f += check("roles lists agents", run(["roles"], env).stdout.includes("planner"));
  f += check("plan works", run(["plan", "add feature", "--dir", repo], env).stdout.includes("Plan:"));
  f += check("orchestrate runs pipeline", run(["orchestrate", "add feature", "--dir", repo], env).stdout.includes("Orchestration report") || run(["orchestrate", "add feature", "--dir", repo], env).stdout.includes("Report"));
  f += check("workflow list", run(["workflow", "list"], env).stdout.includes("full-cycle"));
  f += check("workflow install", run(["workflow", "install", "mini", "--steps", "planner,developer"], env).stdout.includes("Installed workflow"));
  f += check("mcp add/list/discover", run(["mcp", "add", "fs", "--command", "npx fs"], env).stdout.includes("Added") && run(["mcp", "discover", "fs"], env).stdout.includes("Discovered"));
  f += check("extension install", run(["extension", "install", "lint", "--ver", "1.0.0"], env).stdout.includes("Installed"));
  f += check("skill list (builtins)", run(["skill", "list"], env).stdout.includes("react"));
  f += check("task run/list", run(["task", "run", "build"], env).stdout.includes("Queued") && run(["task", "list"], env).stdout.includes("queued"));
  console.log(f === 0 ? "\nPhase 4 smoke test passed. ✓" : `\nPhase 4 smoke test failed with ${f} problem(s).`);
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
}
process.exit(f === 0 ? 0 : 1);
