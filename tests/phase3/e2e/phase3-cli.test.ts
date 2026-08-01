/**
 * Phase 3 e2e: spawn the built CLI against a temp git repository and walk
 * the workspace intelligence + tool execution flows, ending with the
 * Phase 3 exit condition (agent: analyze → change → test → commit).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(process.cwd(), "dist/cli.js");

function run(args: string[], env: Record<string, string> = {}, cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code: code ?? -1, stdout, stderr }));
  });
}

let home = "";
let repo = "";

const env = () => ({ CODER_HOME: home });

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "coder-p3e2e-"));
  repo = mkdtempSync(join(tmpdir(), "coder-p3repo-"));
  cpSync(resolve(process.cwd(), "tests/fixtures/sample-repo"), repo, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: repo });
  spawnSync("git", ["config", "user.email", "e2e@coder.dev"], { cwd: repo });
  spawnSync("git", ["config", "user.name", "E2E"], { cwd: repo });
  spawnSync("git", ["add", "-A"], { cwd: repo });
  spawnSync("git", ["commit", "-qm", "init"], { cwd: repo });
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe("workspace intelligence (spawned CLI)", () => {
  it("coder scan reports the Phase 3 statistics (spec ✓ format)", async () => {
    const res = await run(["scan", "--dir", repo], env());
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("directories detected");
    expect(res.stdout).toContain("source files indexed");
    expect(res.stdout).toContain("functions discovered");
    expect(res.stdout).toContain("classes detected");
    expect(res.stdout).toContain("imports indexed");
    expect(res.stdout).toContain("tests identified");
    expect(res.stdout).toContain("✓");
    expect(res.stdout).toContain("typescript");
  });

  it("coder files, search and explain", async () => {
    const files = await run(["files", "--dir", repo], env());
    expect(files.stdout).toContain("src/auth.ts");
    expect(files.stdout).toContain("test/auth.test.ts");

    const def = await run(["search", "authenticate", "--dir", repo, "--kind", "definition"], env());
    expect(def.stdout).toContain("src/auth.ts");

    const ref = await run(["search", "authenticate", "--dir", repo, "--kind", "references"], env());
    expect(ref.stdout).toContain("src/index.ts");

    const content = await run(["search", "AuthService", "--dir", repo, "--kind", "content"], env());
    expect(content.stdout).toContain("src/auth.ts");

    const explain = await run(["explain", "src/auth.ts", "--dir", repo], env());
    expect(explain.stdout).toContain("authenticate");
    expect(explain.stdout).toContain("AuthService");
    expect(explain.stdout).toContain("test/auth.test.ts");
  });

  it("coder context shows structure, git and docs", async () => {
    const res = await run(["context", "--dir", repo], env());
    expect(res.stdout).toContain("# Repository context");
    expect(res.stdout).toContain("branch: master");
    expect(res.stdout).toContain("Sample repository");
  });

  it("coder tools lists the tool catalogue with levels", async () => {
    const res = await run(["tools"], env());
    expect(res.stdout).toContain("read_file");
    expect(res.stdout).toContain("write_file");
    expect(res.stdout).toContain("execute_command");
    expect(res.stdout).toContain("git_commit");
    expect(res.stdout).toContain("apply_patch");
    expect(res.stdout).toContain("safe");
    expect(res.stdout).toContain("full-auto");
  });
});

describe("tool execution + rollback (spawned CLI)", () => {
  it("coder agent runs the exit-condition flow and commits", async () => {
    const res = await run(
      ["agent", "Analyze the repository.", "--dir", repo, "--level", "full-auto"],
      { ...env(), CODER_PROVIDER: "mock", CODER_MODEL: "mock/coder-1" },
      repo,
    );
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Agent task:");
    expect(res.stdout).toContain("scan");
    expect(res.stdout).toContain("write_file");
    expect(res.stdout).toContain("git_commit");
    expect(res.stdout).toContain("Task complete");
    expect(existsSync(join(repo, "AGENT.md"))).toBe(true);

    const log = spawnSync("git", ["log", "--oneline", "-1"], { cwd: repo, encoding: "utf8" });
    expect(log.stdout).toContain("chore: agent changes");
  });

  it("coder diff shows the tool edits", async () => {
    const res = await run(["diff", "--dir", repo], env());
    expect(res.stdout).toContain("AGENT.md");
  });

  it("coder undo deletes the agent-created file; redo recreates it", async () => {
    const undone = await run(["undo", "--dir", repo], env());
    expect(undone.code).toBe(0);
    expect(existsSync(join(repo, "AGENT.md"))).toBe(false);

    const redone = await run(["redo", "--dir", repo], env());
    expect(redone.code).toBe(0);
    expect(existsSync(join(repo, "AGENT.md"))).toBe(true);
  });

  it("coder checkpoints create / list / restore / delete", async () => {
    const created = await run(["checkpoints", "create", "--dir", repo, "--name", "e2e-cp"], env());
    expect(created.code).toBe(0);
    expect(created.stdout).toContain("Checkpoint created");

    const listed = await run(["checkpoints", "--dir", repo], env());
    expect(listed.stdout).toContain("e2e-cp");

    // Modify a file, restore from the checkpoint.
    writeFileSync(join(repo, "src/utils.ts"), "// broken\n");
    const id = /e2e-cp-[\w]+/.exec(listed.stdout)?.[0];
    const restored = await run(["checkpoints", "restore", id!, "--dir", repo], env());
    expect(restored.code).toBe(0);
    expect(readFileSync(join(repo, "src/utils.ts"), "utf8")).toContain("hashPassword");

    const deleted = await run(["checkpoints", "delete", id!, "--dir", repo], env());
    expect(deleted.code).toBe(0);
  });

  it("permission levels gate the agent (safe denies writes)", async () => {
    const res = await run(
      ["agent", "Add authentication.", "--dir", repo, "--level", "safe"],
      { ...env(), CODER_PROVIDER: "mock", CODER_MODEL: "mock/coder-1" },
      repo,
    );
    // The mock sequence hits write_file at safe level → permission denied,
    // but the loop continues and finishes with the scripted answer.
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Permission denied");
  });
});

describe("chat slash commands (spawned CLI)", () => {
  it("runs /files, /context and /explain inside the chat", async () => {
    const child = spawn(
      process.execPath,
      [CLI, "chat", "--repl", "--no-stream"],
      { env: { ...process.env, ...env(), CODER_PROVIDER: "mock", CODER_MODEL: "mock/coder-1" }, stdio: ["pipe", "pipe", "pipe"], cwd: repo },
    );
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    const done = new Promise<number | null>((r) => child.on("close", r));
    child.stdin.write("/files\n");
    child.stdin.write("/context\n");
    child.stdin.write("/explain src/auth.ts\n");
    child.stdin.write("/exit\n");
    child.stdin.end();
    const code = await done;
    expect(code).toBe(0);
    expect(stdout).toContain("src/auth.ts");
    expect(stdout).toContain("# Repository context");
    expect(stdout).toContain("AuthService");
  });

  it("chat --full-auto runs the agent on ordinary messages", async () => {
    const child = spawn(
      process.execPath,
      [CLI, "chat", "--repl", "--no-stream", "--full-auto"],
      { env: { ...process.env, ...env(), CODER_PROVIDER: "mock", CODER_MODEL: "mock/coder-1" }, stdio: ["pipe", "pipe", "pipe"], cwd: repo },
    );
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    const done = new Promise<number | null>((r) => child.on("close", r));
    child.stdin.write("Analyze the repository.\n");
    child.stdin.write("/exit\n");
    child.stdin.end();
    const code = await done;
    expect(code).toBe(0);
    expect(stdout).toContain("→ scan");
    expect(stdout).toContain("Agent:");
  });
});
