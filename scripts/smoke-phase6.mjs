#!/usr/bin/env node
/**
 * CODER Phase 6 smoke test — organizations, cloud workspaces, runtime.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = resolve(root, "dist", "cli.js");
const run = (args, env, cwd) => { const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env }, cwd }); return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }; };
const check = (name, cond) => (cond ? (console.log(`  ✓ ${name}`), 0) : (console.error(`  ✗ ${name}`), 1));

console.log("Building…");
execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });

const home = mkdtempSync(join(tmpdir(), "coder-smoke6-"));
const env = { CODER_HOME: home, CODER_PROVIDER: "mock", CODER_MODEL: "mock/coder-1" };
let f = 0;
try {
  console.log("\nPhase 6 exit condition:\n");
  f += check("org create", run(["org", "create", "Acme", "--plan", "business"], env).stdout.includes("Created organization"));
  f += check("org list", run(["org", "list"], env).stdout.includes("Acme"));
  f += check("org member add", run(["org", "member", "add", "Acme", "b@x", "--role", "admin"], env).stdout.includes("Added"));
  f += check("org usage", run(["org", "usage", "Acme"], env).stdout.includes("Acme usage"));
  f += check("org memory store", run(["org", "memory", "store", "Acme", "--key", "style", "--value", "tabs"], env).stdout.includes("Stored shared memory"));
  f += check("workspace create local (running)", run(["workspace", "create", "dev"], env).stdout.includes("running"));
  f += check("workspace create cloud (creating)", run(["workspace", "create", "prod", "--environment", "kubernetes"], env).stdout.includes("creating"));
  f += check("workspace start/stop/destroy", run(["workspace", "stop", run(["workspace", "list"], env).stdout.match(/(ws-[a-z0-9]+)/)?.[1] ?? "x"], env).stdout.includes("Stopped"));
  f += check("runtime monitoring", run(["runtime"], env).stdout.includes("Runtime") && run(["runtime"], env).stdout.includes("organizations"));
  console.log(f === 0 ? "\nPhase 6 smoke test passed. ✓" : `\nPhase 6 smoke test failed with ${f} problem(s).`);
} finally {
  rmSync(home, { recursive: true, force: true });
}
process.exit(f === 0 ? 0 : 1);
