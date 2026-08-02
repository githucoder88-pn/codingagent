#!/usr/bin/env node
/**
 * CODER Phase 9 smoke test — autonomous engineering civilization: directors,
 * civilization run, cluster, organization mode memory levels.
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

const home = mkdtempSync(join(tmpdir(), "coder-smoke9-"));
const repo = mkdtempSync(join(tmpdir(), "coder-smoke9-repo-"));
cpSync(join(root, "tests", "fixtures", "sample-repo"), repo, { recursive: true });
const env = { CODER_HOME: home, CODER_PROVIDER: "mock", CODER_MODEL: "mock/coder-1" };
let f = 0;
try {
  console.log("\nPhase 9 exit condition:\n");
  f += check("civilization status lists directors", run(["civilization", "status"], env).stdout.includes("Executive Director"));
  const civ = run(["civilization", "run", "harden security and deploy", "--dir", repo], env);
  f += check("civilization run executes", civ.code === 0 && civ.stdout.includes("Allocated directors"));
  f += check("keyword heuristics engaged security", civ.stdout.includes("security"));
  f += check("director dispatch", run(["director", "architect", "design api", "--dir", repo], env).code === 0);
  f += check("civ alias works", run(["civ", "improve tests", "--dir", repo], env).code === 0);
  f += check("global memory level", run(["memory", "store", "g", "v", "--scope", "global"], env).stdout.includes("[global]"));
  f += check("cluster-status alias", run(["cluster-status"], env).stdout.includes("Cluster"));
  console.log(f === 0 ? "\nPhase 9 smoke test passed. ✓" : `\nPhase 9 smoke test failed with ${f} problem(s).`);
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
}
process.exit(f === 0 ? 0 : 1);
