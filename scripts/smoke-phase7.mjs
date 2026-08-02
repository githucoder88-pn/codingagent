#!/usr/bin/env node
/**
 * CODER Phase 7 smoke test — adaptive cognitive intelligence: evolve,
 * research, reflection markers, memory hierarchy.
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

const home = mkdtempSync(join(tmpdir(), "coder-smoke7-"));
const repo = mkdtempSync(join(tmpdir(), "coder-smoke7-repo-"));
cpSync(join(root, "tests", "fixtures", "sample-repo"), repo, { recursive: true });
const env = { CODER_HOME: home, CODER_PROVIDER: "mock", CODER_MODEL: "mock/coder-1" };
let f = 0;
try {
  console.log("\nPhase 7 exit condition:\n");
  const evolve = run(["evolve", "add a login form and tests", "--dir", repo], env);
  f += check("evolve runs loop", evolve.code === 0 && evolve.stdout.includes("Outcome:"));
  f += check("evolve tunes risk threshold", evolve.stdout.includes("risk"));
  const research = run(["research", "authenticate", "--dir", repo], env);
  f += check("research synthesises", research.code === 0 && research.stdout.includes("Summary"));
  f += check("long-term memory hierarchy", run(["memory", "store", "lesson", "ship offline", "--scope", "long-term"], env).stdout.includes("[user]"));
  f += check("cognitive reflects outcomes", run(["cognitive", "status"], env).stdout.includes("reflections"));
  console.log(f === 0 ? "\nPhase 7 smoke test passed. ✓" : `\nPhase 7 smoke test failed with ${f} problem(s).`);
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
}
process.exit(f === 0 ? 0 : 1);
