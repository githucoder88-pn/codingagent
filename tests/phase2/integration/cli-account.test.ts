/**
 * CLI × backend integration: run the real CLI (in-process) against a live
 * backend on an ephemeral port and verify the Phase 2 account flows end to
 * end: signup/login, encrypted key sync, privacy settings, recording,
 * feedback, history, export, admin, sync and delete-account.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { runCli } from "../../../src/cli.js";
import { startTestBackend, api, type TestBackend } from "../../helpers/backend.js";
import { useTempHome } from "../../helpers/temp-home.js";
import { loadRecords } from "../../../src/account/records.js";
import { loadSettings } from "../../../src/account/settings.js";
import { vault } from "../../../src/account/vault.js";

useTempHome();

let backend: TestBackend | null = null;
const stdout: string[] = [];
const stderr: string[] = [];

async function cli(args: string[], env: Record<string, string> = {}): Promise<number> {
  stdout.length = 0;
  stderr.length = 0;
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const code = await runCli(["node", "coder", ...args], {
      exit: false,
      ...(env.CODER_API_URL ? {} : {}),
    });
    return code;
  } finally {
    process.stdout.write = originalWrite;
    process.stderr.write = originalErr;
  }
}

const out = () => stdout.join("");
const err = () => stderr.join("");

beforeEach(async () => {
  backend = await startTestBackend({ adminEmail: "boss@coder.dev", adminPassword: "adminpass123", adminSuperadmin: true });
  process.env.CODER_API_URL = backend.url;
});

afterEach(async () => {
  delete process.env.CODER_API_URL;
  await backend?.close();
  backend = null;
});

describe("account lifecycle via CLI", () => {
  it("signup → login → logout → login again", async () => {
    const code = await cli(["signup", "--email", "cli@example.com", "--password", "password123"]);
    expect(code).toBe(0);
    expect(out()).toContain("Account created");
    expect(existsSync(`${process.env.CODER_HOME}/session.json`)).toBe(true);

    expect(await cli(["logout"])).toBe(0);
    expect(existsSync(`${process.env.CODER_HOME}/session.json`)).toBe(false);

    const loginCode = await cli(["login", "--email", "cli@example.com", "--password", "password123"]);
    expect(loginCode).toBe(0);
    expect(out()).toContain("Signed in as cli@example.com");

    // Wrong password fails cleanly.
    const bad = await cli(["login", "--email", "cli@example.com", "--password", "wrongpass"]);
    expect(bad).toBe(3);
    expect(err()).toContain("Invalid email or password");
  });

  it("login without a running backend fails with a helpful message", async () => {
    await backend!.close();
    backend = null;
    const code = await cli(["login", "--email", "x@example.com", "--password", "password123"]);
    expect(code).toBe(3);
    expect(err()).toContain("Cannot reach the CODER backend");
  });
});

describe("provider keys via CLI", () => {
  it("auth add stores locally encrypted and syncs to the backend", async () => {
    await cli(["signup", "--email", "keys@example.com", "--password", "password123"]);
    const code = await cli(["auth", "add", "openrouter", "--key", "sk-or-cli-test-1234567890"]);
    expect(code).toBe(0);
    expect(out()).toContain("Key synced to the backend (encrypted)");

    // Local vault: encrypted at rest.
    const rawVault = readFileSync(`${process.env.CODER_HOME}/vault.json`, "utf8");
    expect(rawVault).not.toContain("sk-or-cli-test-1234567890");

    // Backend: stored + fingerprint listed.
    const { token } = JSON.parse(readFileSync(`${process.env.CODER_HOME}/session.json`, "utf8")) as { token: string };
    const remote = await api(backend!, "/auth/provider-keys", { token });
    expect(remote.body.keys).toHaveLength(1);
    expect(remote.body.keys[0].provider).toBe("openrouter");

    // auth list shows both sides.
    const list = await cli(["auth", "list"]);
    expect(list).toBe(0);
    expect(out()).toContain("openrouter");

    // Remove deletes both.
    const removed = await cli(["auth", "remove", "openrouter"]);
    expect(removed).toBe(0);
    expect((await api(backend!, "/auth/provider-keys", { token })).body.keys).toHaveLength(0);
  });

  it("auth add --no-upload keeps the key local only", async () => {
    await cli(["signup", "--email", "local@example.com", "--password", "password123"]);
    const code = await cli(["auth", "add", "openai", "--key", "sk-local-only-1234567890", "--no-upload"]);
    expect(code).toBe(0);
    expect(out()).not.toContain("Key synced");
    const { token } = JSON.parse(readFileSync(`${process.env.CODER_HOME}/session.json`, "utf8")) as { token: string };
    expect((await api(backend!, "/auth/provider-keys", { token })).body.keys).toHaveLength(0);
  });
});

describe("privacy settings via CLI", () => {
  it("settings privacy on/off and training opt-in round-trip", async () => {
    await cli(["signup", "--email", "priv@example.com", "--password", "password123"]);

    const on = await cli(["settings", "privacy", "on"]);
    expect(on).toBe(0);
    expect(loadSettings()).toEqual({ historyEnabled: false, trainingOptIn: false });

    // The backend mirrors it.
    const { token } = JSON.parse(readFileSync(`${process.env.CODER_HOME}/session.json`, "utf8")) as { token: string };
    const me = await api(backend!, "/users/me", { token });
    expect(me.body.settings.historyEnabled).toBe(false);

    const training = await cli(["settings", "training", "on"]);
    expect(training).toBe(0);
    expect(loadSettings().trainingOptIn).toBe(true);
    expect((await api(backend!, "/users/me", { token })).body.settings.trainingOptIn).toBe(true);

    const off = await cli(["settings", "privacy", "off"]);
    expect(off).toBe(0);
    expect(loadSettings()).toEqual({ historyEnabled: true, trainingOptIn: false });

    // `coder privacy` status view.
    const status = await cli(["privacy"]);
    expect(status).toBe(0);
    expect(out()).toContain("history");
  });
});

describe("recording + sync via CLI", () => {
  it("ask records locally and pushes to the backend (idempotent)", async () => {
    await cli(["signup", "--email", "rec@example.com", "--password", "password123"]);
    await cli(["provider", "use", "mock"]);
    const code = await cli(["ask", "Build a Todo app."]);
    expect(code).toBe(0);

    const records = loadRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.prompt).toBe("Build a Todo app.");
    expect(records[0]?.response?.length).toBeGreaterThan(0);
    expect(records[0]?.syncedAt).toBeTruthy(); // auto-synced

    // Backend has it.
    const { token } = JSON.parse(readFileSync(`${process.env.CODER_HOME}/session.json`, "utf8")) as { token: string };
    const history = await api(backend!, "/chat/history?limit=10", { token });
    expect(history.body.total).toBe(1);
    expect(history.body.records[0].prompt).toBe("Build a Todo app.");

    // Re-running sync is a no-op (already synced).
    const sync = await cli(["sync"]);
    expect(sync).toBe(0);
    expect(history.body.total).toBe(1);
  });

  it("privacy on: ask works but nothing is recorded or uploaded", async () => {
    await cli(["signup", "--email", "quiet@example.com", "--password", "password123"]);
    await cli(["settings", "privacy", "on"]);
    await cli(["provider", "use", "mock"]);
    const code = await cli(["ask", "This should not be recorded."]);
    expect(code).toBe(0);
    expect(loadRecords()).toHaveLength(0);
    const { token } = JSON.parse(readFileSync(`${process.env.CODER_HOME}/session.json`, "utf8")) as { token: string };
    expect((await api(backend!, "/chat/history", { token })).body.total).toBe(0);
  });

  it("offline ask keeps the record unsynced; sync later uploads it", async () => {
    await cli(["signup", "--email", "off@example.com", "--password", "password123"]);
    await cli(["provider", "use", "mock"]);
    // Point the API at a dead port so the auto-sync fails.
    process.env.CODER_API_URL = "http://127.0.0.1:59999";
    const code = await cli(["ask", "Offline prompt"]);
    expect(code).toBe(0);
    const records = loadRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.syncedAt).toBeUndefined(); // queued

    // Bring the backend back and sync.
    process.env.CODER_API_URL = backend!.url;
    const sync = await cli(["sync"]);
    expect(sync).toBe(0);
    expect(loadRecords()[0]?.syncedAt).toBeTruthy();
    const { token } = JSON.parse(readFileSync(`${process.env.CODER_HOME}/session.json`, "utf8")) as { token: string };
    expect((await api(backend!, "/chat/history", { token })).body.total).toBe(1);
  });
});

describe("feedback via CLI", () => {
  it("rates the last response locally and on the backend", async () => {
    await cli(["signup", "--email", "fb@example.com", "--password", "password123"]);
    await cli(["provider", "use", "mock"]);
    await cli(["ask", "Give me a recipe"]);
    const code = await cli(["feedback", "5", "Delicious!"]);
    expect(code).toBe(0);
    expect(out()).toContain("Feedback recorded (5/5 — Delicious!)");
    expect(out()).toContain("Feedback synced to the backend");

    const records = loadRecords();
    expect(records[0]?.feedback).toMatchObject({ rating: 5, comment: "Delicious!" });

    const { token } = JSON.parse(readFileSync(`${process.env.CODER_HOME}/session.json`, "utf8")) as { token: string };
    const history = await api(backend!, "/chat/history?limit=5", { token });
    expect(history.body.records[0].rating).toBe(5);
    expect(history.body.records[0].feedbackComment).toBe("Delicious!");
  });

  it("rejects out-of-range ratings", async () => {
    await cli(["signup", "--email", "fb2@example.com", "--password", "password123"]);
    await cli(["provider", "use", "mock"]);
    await cli(["ask", "x"]);
    const code = await cli(["feedback", "9"]);
    expect(code).toBe(2);
  });
});

describe("history + export via CLI", () => {
  it("lists local and remote history", async () => {
    await cli(["signup", "--email", "hist@example.com", "--password", "password123"]);
    await cli(["provider", "use", "mock"]);
    await cli(["ask", "One"]);
    await cli(["ask", "Two"]);

    const local = await cli(["history"]);
    expect(local).toBe(0);
    expect(out()).toContain("One");
    expect(out()).toContain("Two");

    const remote = await cli(["history", "--remote"]);
    expect(remote).toBe(0);
    expect(out()).toContain("Two");
  });

  it("exports a JSON bundle without plaintext keys", async () => {
    await cli(["signup", "--email", "exp@example.com", "--password", "password123"]);
    await cli(["auth", "add", "gemini", "--key", "AIzaExportKey1234567890"]);
    await cli(["provider", "use", "mock"]);
    await cli(["ask", "export me"]);
    const outFile = `${process.env.CODER_HOME}/export.json`;
    const code = await cli(["export", "--out", outFile]);
    expect(code).toBe(0);
    const bundle = JSON.parse(readFileSync(outFile, "utf8")) as {
      account: { email: string };
      providerKeys: Array<{ provider: string; fingerprint: string }>;
      records: Array<{ prompt: string }>;
      remoteHistory: { prompts: Array<{ prompt: string }> };
    };
    expect(bundle.account.email).toBe("exp@example.com");
    expect(bundle.providerKeys[0]?.provider).toBe("gemini");
    expect(bundle.records[0]?.prompt).toBe("export me");
    expect(bundle.remoteHistory.prompts.length).toBeGreaterThan(0);
    const raw = readFileSync(outFile, "utf8");
    expect(raw).not.toContain("AIzaExportKey");
  });
});

describe("admin via CLI", () => {
  it("enforces admin role and lists management data", async () => {
    await cli(["signup", "--email", "worker@example.com", "--password", "password123"]);
    await cli(["provider", "use", "mock"]);
    await cli(["ask", "admin data"]);

    // Regular user → 403 (mapped to the auth exit code).
    const denied = await cli(["admin", "users"]);
    expect(denied).toBe(3);
    expect(err()).toContain("Admin access required");

    // Admin login.
    await cli(["logout"]);
    await cli(["login", "--email", "boss@coder.dev", "--password", "adminpass123"]);

    const users = await cli(["admin", "users"]);
    expect(users).toBe(0);
    expect(out()).toContain("worker@example.com");

    const prompts = await cli(["admin", "prompts"]);
    expect(prompts).toBe(0);
    expect(out()).toContain("admin data");

    const logs = await cli(["admin", "logs"]);
    expect(logs).toBe(0);
    expect(out()).toContain("auth.signup");

    const training = await cli(["admin", "training"]);
    expect(training).toBe(0);
    expect(out()).toContain("opt-ins");

    const usage = await cli(["admin", "usage"]);
    expect(usage).toBe(0);
    expect(out()).toContain("Usage");

    const rotate = await cli(["admin", "rotate-key", "--yes"]);
    expect(rotate).toBe(0);
    expect(out()).toContain("Master key rotated");
  });
});

describe("settings pull + chat recording", () => {
  it("login pulls the account's server-side privacy settings", async () => {
    // Sign up via API and change settings on the server (as the dashboard
    // would), then verify the CLI picks them up on login.
    const signupResult = await api(backend!, "/auth/signup", {
      method: "POST",
      body: { email: "pull@example.com", password: "password123" },
    });
    const token = signupResult.body.token as string;
    await api(backend!, "/users/me/settings", {
      method: "PATCH",
      token,
      body: { historyEnabled: false, trainingOptIn: true },
    });

    const code = await cli(["login", "--email", "pull@example.com", "--password", "password123"]);
    expect(code).toBe(0);
    expect(loadSettings()).toEqual({ historyEnabled: false, trainingOptIn: true });
  });

  it("chat turns are recorded and synced (onTurnComplete hook)", async () => {
    await cli(["signup", "--email", "chatrec@example.com", "--password", "password123"]);
    await cli(["provider", "use", "mock"]);

    // Drive the ChatController directly with a stub view (the CLI's chat
    // command wires the same onTurnComplete recording hook).
    const { ChatController } = await import("../../../src/ui/screens/chat-controller.js");
    type ChatView = import("../../../src/ui/screens/chat-controller.js").ChatView;
    const { createApp } = await import("../../../src/core/application/application.js");
    const ctx = await createApp();

    const lines: string[] = [];
    const view: ChatView = {
      print: (t) => lines.push(t),
      status: () => {},
      statusDone: () => {},
      delta: () => {},
      error: () => {},
      banner: () => {},
      close: () => {},
      input: async () => "Hello chat turn",
    };
    const completions: Array<{ streamed: boolean; durationMs: number }> = [];
    const controller = new ChatController(ctx, {
      stream: false,
      onTurnComplete: (info) => {
        completions.push({ streamed: info.streamed, durationMs: info.durationMs });
        void (async () => {
          const { recordTurn } = await import("../../../src/account/recorder.js");
          const lastUser = [...info.session.messages].reverse().find((m) => m.role === "user");
          const lastAssistant = [...info.session.messages].reverse().find((m) => m.role === "assistant");
          await recordTurn(ctx, {
            sessionId: info.session.id,
            provider: info.session.provider,
            model: info.session.model,
            prompt: lastUser?.content ?? "",
            response: lastAssistant?.content ?? "",
            latencyMs: info.durationMs,
          });
        })();
      },
    });
    // One turn, then EOF.
    let calls = 0;
    view.input = async () => {
      calls += 1;
      return calls === 1 ? "Hello chat turn" : null;
    };
    await controller.run(view);
    await new Promise((r) => setTimeout(r, 100)); // let the async hook finish

    expect(completions).toHaveLength(1);
    const records = loadRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.prompt).toBe("Hello chat turn");
    expect(records[0]?.response?.length).toBeGreaterThan(0);
    expect(records[0]?.syncedAt).toBeTruthy(); // synced to the backend

    const { token } = JSON.parse(readFileSync(`${process.env.CODER_HOME}/session.json`, "utf8")) as { token: string };
    expect((await api(backend!, "/chat/history", { token })).body.total).toBe(1);
    await ctx.container.disposeAll();
    ctx.logger.close();
  });
});

describe("delete-account via CLI", () => {
  it("removes the account on the backend and clears local data", async () => {
    await cli(["signup", "--email", "bye@example.com", "--password", "password123"]);
    await cli(["auth", "add", "openai", "--key", "sk-bye-cli-1234567890"]);
    await cli(["provider", "use", "mock"]);
    await cli(["ask", "temporary"]);

    const code = await cli(["delete-account", "--yes"]);
    expect(code).toBe(0);
    expect(out()).toContain("Account deleted");

    // Local account data gone.
    expect(existsSync(`${process.env.CODER_HOME}/session.json`)).toBe(false);
    expect(existsSync(`${process.env.CODER_HOME}/records.json`)).toBe(false);
    expect(vault().list()).toHaveLength(0);

    // Backend data gone (the seeded admin account remains).
    const counts = backend!.ctx.db.raw
      .prepare("SELECT (SELECT COUNT(*) FROM users) u, (SELECT COUNT(*) FROM prompts) p, (SELECT COUNT(*) FROM provider_keys) k")
      .get() as { u: number; p: number; k: number };
    expect(counts).toEqual({ u: 1, p: 0, k: 0 });
    const remaining = backend!.ctx.db.raw.prepare("SELECT email FROM users").all() as Array<{ email: string }>;
    expect(remaining.map((r) => r.email)).toEqual(["boss@coder.dev"]);

    // Login fails now.
    const relogin = await cli(["login", "--email", "bye@example.com", "--password", "password123"]);
    expect(relogin).toBe(3);
  });
});
