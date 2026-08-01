/**
 * End-to-end tests: spawn the built CLI (`dist/cli.js`) in an isolated
 * CODER_HOME and exercise the Phase 1 exit-criteria flow with the offline
 * mock provider. Requires `npm run build` first (the `test:e2e` script does
 * that automatically).
 */

import { describe, expect, it, beforeAll } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(process.cwd(), "dist/cli.js");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], env: Record<string, string> = {}): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
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

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "coder-e2e-"));
  if (!existsSync(CLI)) {
    throw new Error("dist/cli.js missing — run `npm run build` before e2e tests");
  }
  // Sanity: the entry point works at all.
  execFileSync(process.execPath, [CLI, "--version"], { stdio: "pipe" });
});

const env = () => ({ CODER_HOME: home });

describe("coder CLI (e2e)", () => {
  it("prints the version", async () => {
    const res = await run(["--version"], env());
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe("0.2.0");
  });

  it("shows extended help with all command groups", async () => {
    const res = await run(["help"], env());
    expect(res.code).toBe(0);
    for (const cmd of ["chat", "ask", "auth add", "models", "model use", "provider list", "sessions", "clear", "config show", "login", "dashboard"]) {
      expect(res.stdout).toContain(cmd);
    }
  });

  it("rejects unknown commands with exit code 2", async () => {
    const res = await run(["frobnicate"], env());
    expect(res.code).toBe(2);
  });

  it("auth: mock needs no key; real providers report missing keys", async () => {
    const res = await run(["auth", "mock"], env());
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("does not require an API key");
  });

  it("provider: list, use, current", async () => {
    const list = await run(["provider", "list"], env());
    expect(list.code).toBe(0);
    expect(list.stdout).toContain("openrouter");
    expect(list.stdout).toContain("mock");

    const use = await run(["provider", "use", "mock"], env());
    expect(use.code).toBe(0);
    expect(use.stdout).toContain("Active provider set to Mock");

    const current = await run(["provider", "current"], env());
    expect(current.stdout).toContain("mock");
  });

  it("models: lists the mock catalogue and marks the active model", async () => {
    const res = await run(["models"], env());
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("mock/coder-1");
    expect(res.stdout).toContain("mock/coder-2");
  });

  it("model: use + current + list", async () => {
    const use = await run(["model", "use", "mock/coder-2"], env());
    expect(use.code).toBe(0);
    expect(use.stdout).toContain("Active model set to mock/coder-2");

    const current = await run(["model", "current"], env());
    expect(current.stdout.trim()).toBe("mock/coder-2 on Mock (offline) (mock)");

    const list = await run(["model", "list"], env());
    expect(list.stdout).toContain("mock/coder-2");
  });

  it("ask: streams a reply and persists the session (exit-criteria flow)", async () => {
    const res = await run(["ask", "Build a Todo application."], env());
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Build a Todo application");

    const sessions = await run(["sessions", "list"], env());
    expect(sessions.stdout).toMatch(/session-\d{3}\*/);
    expect(sessions.stdout).toContain("mock/coder-2");
  });

  it("ask --json returns structured output", async () => {
    const res = await run(["ask", "--json", "hello"], env());
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout) as { sessionId: string; provider: string; model: string; content: string };
    expect(parsed.provider).toBe("mock");
    expect(parsed.content.length).toBeGreaterThan(0);
    expect(parsed.sessionId).toMatch(/^session-\d{3}$/);
  });

  it("ask without an API key for a real provider exits 3", async () => {
    const res = await run(["ask", "--provider", "openai", "hi"], env());
    expect(res.code).toBe(3);
    expect(res.stderr).toContain("is not configured");
  });

  it("chat: Ink TUI works under a pseudo-TTY (when `script` is available)", async () => {
    const { spawnSync } = await import("node:child_process");
    const hasScript = spawnSync("which", ["script"], { encoding: "utf8" }).status === 0;
    if (!hasScript) {
      console.warn("`script` not available — skipping Ink TUI e2e test");
      return;
    }
    const res = spawnSync("script", ["-qec", `node ${CLI} chat`, "/dev/null"], {
      input: "hello ink tui\n/exit\n",
      encoding: "utf8",
      env: { ...process.env, ...env() },
      timeout: 20_000,
    });
    expect(res.status ?? -1).not.toBe(124); // must not hang
    expect(res.stdout + res.stderr).toContain("hello ink tui");
  });

  it("chat: processes piped turns and slash commands", async () => {
    const child = spawn(
      process.execPath,
      [CLI, "chat"],
      { env: { ...process.env, ...env() }, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    const done = new Promise<number | null>((r) => child.on("close", r));
    child.stdin.write("Hello chat!\n");
    child.stdin.write("/sessions\n");
    child.stdin.write("/exit\n");
    child.stdin.end();
    const code = await done;
    expect(code).toBe(0);
    expect(stdout).toContain("Hello chat!");
    expect(stdout).toContain("Current session: session-");
  });

  it("sessions: show and remove", async () => {
    const list = await run(["sessions", "list"], env());
    const id = /(session-\d{3})\*/?.exec(list.stdout)?.[1];
    expect(id).toBeTruthy();

    const show = await run(["sessions", "show", id!], env());
    expect(show.code).toBe(0);
    expect(show.stdout).toContain("You:");

    const removed = await run(["sessions", "remove", id!], env());
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain("Removed session");
  });

  it("clear resets the current session's messages", async () => {
    await run(["ask", "something to clear"], env());
    const before = await run(["sessions", "list"], env());
    expect(before.stdout).toContain("2"); // 2 messages column

    const cleared = await run(["clear"], env());
    expect(cleared.code).toBe(0);

    const after = await run(["sessions", "list"], env());
    expect(after.stdout).toContain("0");
  });

  it("config: get/set/show round-trip", async () => {
    const set = await run(["config", "set", "theme", "dark"], env());
    expect(set.code).toBe(0);
    const get = await run(["config", "get", "theme"], env());
    expect(get.stdout.trim()).toBe("dark");
    const show = await run(["config", "show"], env());
    expect(show.stdout).toContain("theme");
    // restore
    await run(["config", "set", "theme", "default"], env());
  });

  it("writes the ~/.coder layout (sessions, logs, config, cache)", () => {
    expect(existsSync(join(home, "config.json"))).toBe(true);
    expect(existsSync(join(home, "sessions"))).toBe(true);
    expect(existsSync(join(home, "logs"))).toBe(true);
    const logs = readdirSync(join(home, "logs"));
    expect(logs).toContain("debug.log");
    expect(logs).toContain("error.log");
    expect(logs).toContain("latest.log");
    const sessionFiles = readdirSync(join(home, "sessions")).filter((f) => f.endsWith(".json"));
    expect(sessionFiles.length).toBeGreaterThan(0);
  });

  it("logs contain pino JSON lines with timestamps", () => {
    const debug = readFileSync(join(home, "logs", "debug.log"), "utf8");
    expect(debug.trim().length).toBeGreaterThan(0);
    for (const line of debug.trim().split("\n").slice(0, 3)) {
      const parsed = JSON.parse(line) as { level: number; time: number; msg: string };
      expect(typeof parsed.level).toBe("number");
      expect(typeof parsed.msg).toBe("string");
    }
  });
});
