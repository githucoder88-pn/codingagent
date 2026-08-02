/**
 * End-to-end: the Phase 4–11 command surface through the built CLI, using the
 * offline mock provider so everything is deterministic without a network.
 * Requires `npm run build` first.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(process.cwd(), "dist/cli.js");
const FIXTURE = resolve(process.cwd(), "tests/fixtures/sample-repo");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], env: Record<string, string>): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code: code ?? -1, stdout, stderr }));
  });
}

let home = "";
let repoDir = "";
beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "coder-phase-e2e-"));
  repoDir = mkdtempSync(join(tmpdir(), "coder-phase-repo-"));
  cpSync(FIXTURE, repoDir, { recursive: true });
  if (!existsSync(CLI)) throw new Error("dist/cli.js missing — run `npm run build` first");
  execFileSync(process.execPath, [CLI, "--version"], { stdio: "pipe" });
});

const env = () => ({ CODER_HOME: home, CODER_PROVIDER: "mock", CODER_MODEL: "mock/coder-1" });

describe("Phase 4–11 command surface (e2e)", () => {
  it("help lists the new command groups", async () => {
    const res = await run(["help"], env());
    expect(res.code).toBe(0);
    for (const cmd of ["orchestrate", "plan", "mcp", "extension", "skill", "task", "workflow", "memory", "cognitive", "evolve", "research", "knowledge", "model", "org", "workspace", "civilization", "director", "cluster", "worker", "run", "pet", "daemon", "restore", "status", "connect", "sync", "checkpoint"]) {
      expect(res.stdout).toContain(cmd);
    }
  });

  it("roles + knowledge + memory + tasks all work", async () => {
    expect((await run(["roles"], env())).stdout).toContain("planner");
    expect((await run(["knowledge", "graph", "--dir", repoDir], env())).stdout).toContain("rebuilt");
    expect((await run(["knowledge", "stats"], env())).stdout).toContain("Knowledge graph");
    expect((await run(["memory", "store", "goal", "ship-v7", "--scope", "user"], env())).stdout).toContain("Stored");
    expect((await run(["memory", "recall", "goal"], env())).stdout).toContain("ship-v7");
    expect((await run(["task", "run", "build it"], env())).code).toBe(0);
    expect((await run(["task", "list"], env())).stdout).toContain("queued");
  });

  it("mcp + extension + skill + workflow management", async () => {
    expect((await run(["mcp", "add", "fs", "--command", "npx fs"], env())).stdout).toContain("Added");
    expect((await run(["mcp", "list"], env())).stdout).toContain("fs");
    expect((await run(["extension", "install", "lint", "--ver", "2.0.0"], env())).stdout).toContain("Installed");
    expect((await run(["extension", "list"], env())).stdout).toContain("lint");
    expect((await run(["skill", "list"], env())).stdout).toContain("react");
    expect((await run(["workflow", "list"], env())).stdout).toContain("full-cycle");
  });

  it("organizations + workspaces + runtime + cluster", async () => {
    expect((await run(["org", "create", "Acme"], env())).stdout).toContain("Created organization");
    expect((await run(["org", "list"], env())).stdout).toContain("Acme");
    expect((await run(["workspace", "create", "dev"], env())).stdout).toContain("Created workspace");
    expect((await run(["workspace", "list"], env())).stdout).toContain("dev");
    expect((await run(["runtime"], env())).stdout).toContain("Runtime");
    expect((await run(["worker", "--name", "n1", "--region", "us"], env())).stdout).toContain("Registered");
    expect((await run(["cluster", "status"], env())).stdout).toContain("Cluster");
  });

  it("cognitive + evolve + research + civilization against a repo", async () => {
    expect((await run(["cognitive", "status"], env())).stdout).toContain("Cognitive core");
    const evolve = await run(["evolve", "add tests", "--dir", repoDir], env());
    expect(evolve.code).toBe(0);
    expect(evolve.stdout).toContain("Outcome:");
    const research = await run(["research", "authenticate", "--dir", repoDir], env());
    expect(research.code).toBe(0);
    expect(research.stdout).toContain("Summary");
    const civ = await run(["civilization", "run", "fix the auth bug", "--dir", repoDir], env());
    expect(civ.code).toBe(0);
    expect(civ.stdout).toContain("Civilization goal");
    const director = await run(["director", "architect", "design the api", "--dir", repoDir], env());
    expect(director.code).toBe(0);
  });

  it("offline-first: status, pet, daemon, connect, run --mode offline, restore", async () => {
    expect((await run(["--offline"], env())).stdout).toContain("offline");
    expect((await run(["status", "--json"], env())).code).toBe(0);
    expect((await run(["pet", "--autonomous"], env())).stdout).toContain("Awaiting instructions");
    expect((await run(["daemon", "start"], env())).stdout).toContain("Daemon");
    expect((await run(["daemon", "status"], env())).stdout).toContain("Daemon");
    expect((await run(["daemon", "stop"], env())).code).toBe(0);
    expect((await run(["connect", "workspace", "ws-9"], env())).stdout).toContain("Connection recorded");
    expect((await run(["connect", "list"], env())).stdout).toContain("ws-9");
    const offlineRun = await run(["run", "summarize", "--dir", repoDir, "--mode", "offline"], env());
    expect(offlineRun.code).toBe(0);
    expect(offlineRun.stdout).toContain("Result");
    // model benchmark against mock
    expect((await run(["model", "benchmark", "--provider", "mock"], env())).stdout).toContain("Model benchmark");
  });

  it("checkpoint alias mirrors checkpoints", async () => {
    expect((await run(["checkpoint", "create", "--dir", repoDir, "--name", "e2e"], env())).stdout).toContain("Checkpoint created");
    expect((await run(["checkpoint", "list", "--dir", repoDir], env())).stdout).toContain("e2e");
  });
});
