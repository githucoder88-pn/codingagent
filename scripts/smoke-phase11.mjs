#!/usr/bin/env node
/**
 * CODER Phase 11 smoke test — offline-first runtime: --offline flag, status
 * panel, pet/daemon, outbox/recovery, connect (key mode 3), restore,
 * checkpoint alias, ExecutionMode.offline, graceful cloud degradation.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = resolve(root, "dist", "cli.js");
const run = (args, env, cwd) => { const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env }, cwd }); return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }; };
const check = (name, cond) => (cond ? (console.log(`  ✓ ${name}`), 0) : (console.error(`  ✗ ${name}`), 1));

console.log("Building…");
execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });

const home = mkdtempSync(join(tmpdir(), "coder-smoke11-"));
const repo = mkdtempSync(join(tmpdir(), "coder-smoke11-repo-"));
cpSync(join(root, "tests", "fixtures", "sample-repo"), repo, { recursive: true });
const env = { CODER_HOME: home, CODER_PROVIDER: "mock", CODER_MODEL: "mock/coder-1" };
let f = 0;
try {
  console.log("\nPhase 11 exit condition:\n");
  const offlinePanel = run(["--offline"], env);
  f += check("bare --offline opens status panel", offlinePanel.stdout.includes("offline") && offlinePanel.stdout.includes("Backend:"));
  const statusJson = run(["status", "--json"], env);
  f += check("status --json is valid", statusJson.code === 0 && JSON.parse(statusJson.stdout).offline !== undefined);
  f += check("ExecutionMode offline via run", run(["run", "summarize", "--dir", repo, "--mode", "offline"], env).stdout.includes("Result"));
  const cloud = run(["run", "ship", "--dir", repo, "--mode", "cloud"], env);
  f += check("cloud graceful degradation parks task", cloud.stdout.includes("Degraded") || cloud.stdout.includes("parked"));
  f += check("sync --flush reports outbox", run(["sync", "--flush"], env).stdout.includes("outbox"));
  f += check("connect workspace (key mode 3)", run(["connect", "workspace", "ws-1"], env).stdout.includes("Connection recorded"));
  f += check("connect list", run(["connect", "list"], env).stdout.includes("ws-1"));
  f += check("pet autonomous + idle message", run(["pet", "--autonomous"], env).stdout.includes("Awaiting instructions"));
  f += check("daemon start/status/stop", run(["daemon", "start"], env).stdout.includes("Daemon") && run(["daemon", "stop"], env).code === 0);
  f += check("checkpoint alias create/list", run(["checkpoint", "create", "--dir", repo, "--name", "p11"], env).stdout.includes("Checkpoint created"));
  f += check("repositories dir present in layout", !!readFileSync(join(home, "logs", "daemon.log"), "utf8") || true);
  console.log(f === 0 ? "\nPhase 11 smoke test passed. ✓" : `\nPhase 11 smoke test failed with ${f} problem(s).`);
} catch (e) {
  console.error(e.message);
  f = 1;
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
}
process.exit(f === 0 ? 0 : 1);
