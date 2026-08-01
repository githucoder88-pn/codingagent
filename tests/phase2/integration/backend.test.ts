/**
 * Backend integration tests: the full control-plane API surface on an
 * ephemeral server — auth, encrypted keys, recording, privacy, feedback,
 * admin, export, deletion, rotation, proxy.
 */

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { startTestBackend, api, signup, type TestBackend } from "../../helpers/backend.js";
import { fingerprint } from "../../../shared/src/index.js";
import { useTempHome } from "../../helpers/temp-home.js";

useTempHome();

let backend: TestBackend | null = null;

async function freshBackend(overrides: Parameters<typeof startTestBackend>[0] = {}) {
  await backend?.close();
  backend = await startTestBackend(overrides);
  return backend;
}

afterEach(async () => {
  await backend?.close();
  backend = null;
});

describe("auth", () => {
  it("signs up, logs in, reads session, logs out", async () => {
    const b = await freshBackend();
    const { token, user } = await signup(b, "alice@example.com");

    const session = await api(b, "/auth/session", { token });
    expect(session.status).toBe(200);
    expect(session.body.user.email).toBe("alice@example.com");
    expect(session.body.user.role).toBe("user");
    expect(session.body.user.hashedPassword).toBeUndefined();

    // Login with wrong password → 401.
    const bad = await api(b, "/auth/login", { method: "POST", body: { email: "alice@example.com", password: "nope" } });
    expect(bad.status).toBe(401);

    // Duplicate signup → 409.
    const dup = await api(b, "/auth/signup", { method: "POST", body: { email: "alice@example.com", password: "password123" } });
    expect(dup.status).toBe(409);

    // Logout revokes the session.
    const out = await api(b, "/auth/logout", { method: "POST", token });
    expect(out.status).toBe(200);
    const after = await api(b, "/auth/session", { token });
    expect(after.status).toBe(401);
    void user;
  });

  it("rejects signup with a weak password and bad email", async () => {
    const b = await freshBackend();
    expect((await api(b, "/auth/signup", { method: "POST", body: { email: "x@y.z", password: "short" } })).status).toBe(400);
    expect((await api(b, "/auth/signup", { method: "POST", body: { email: "not-an-email", password: "password123" } })).status).toBe(400);
  });

  it("protects routes without a token", async () => {
    const b = await freshBackend();
    const getPaths = ["/users/me", "/chat/history", "/admin/users"];
    for (const path of getPaths) {
      expect((await api(b, path)).status, path).toBe(401);
    }
    expect((await api(b, "/export", { method: "POST" })).status).toBe(401);
    expect((await api(b, "/delete-account", { method: "POST" })).status).toBe(401);
    expect((await api(b, "/chat/prompt", { method: "POST", body: { prompt: "x" } })).status).toBe(401);
  });
});

describe("provider keys (encrypted at rest)", () => {
  it("stores keys encrypted, lists fingerprints only, deletes", async () => {
    const b = await freshBackend();
    const { token, user } = await signup(b, "keys@example.com");

    const add = await api(b, "/auth/provider-key", { method: "POST", token, body: { provider: "openrouter", apiKey: "sk-or-v1-test-1234567890" } });
    expect(add.status).toBe(201);
    expect(add.body.fingerprint).toBe(fingerprint("sk-or-v1-test-1234567890").slice(0, 16));
    expect(add.body.storedEncrypted).toBe(true);

    // Raw DB must not contain the plaintext key.
    const raw = readFileSync(b.ctx.config.dbPath, "utf8");
    expect(raw).not.toContain("sk-or-v1-test-1234567890");

    const list = await api(b, "/auth/provider-keys", { token });
    expect(list.body.keys).toEqual([
      expect.objectContaining({ provider: "openrouter", fingerprint: fingerprint("sk-or-v1-test-1234567890").slice(0, 16) }),
    ]);
    expect(JSON.stringify(list.body.keys)).not.toContain("sk-or-v1");

    // Upsert replaces the key.
    const reAdd = await api(b, "/auth/provider-key", { method: "POST", token, body: { provider: "openrouter", apiKey: "sk-or-v1-new-key-000000000000" } });
    expect(reAdd.status).toBe(201);
    expect(reAdd.body.fingerprint).toBe(fingerprint("sk-or-v1-new-key-000000000000").slice(0, 16));

    const remove = await api(b, "/auth/provider-key/openrouter", { method: "DELETE", token });
    expect(remove.status).toBe(200);
    expect((await api(b, "/auth/provider-keys", { token })).body.keys).toHaveLength(0);
    void user;
  });

  it("rejects invalid keys", async () => {
    const b = await freshBackend();
    const { token } = await signup(b, "keys2@example.com");
    expect((await api(b, "/auth/provider-key", { method: "POST", token, body: { provider: "openrouter", apiKey: "short" } })).status).toBe(400);
    expect((await api(b, "/auth/provider-key", { method: "POST", token, body: { provider: "nope", apiKey: "sk-or-12345678" } })).status).toBe(400);
  });
});

describe("chat records + privacy", () => {
  it("records prompts/responses idempotently and lists history", async () => {
    const b = await freshBackend();
    const { token } = await signup(b, "chat@example.com");

    const first = await api(b, "/chat/prompt", {
      method: "POST",
      token,
      body: { clientRecordId: "rec_1", sessionId: "s1", provider: "openai", model: "gpt-4o", prompt: "Hello", response: "Hi!", tokensUsed: 5, latencyMs: 100 },
    });
    expect(first.status).toBe(201);
    expect(first.body.recorded).toBe(true);

    // Idempotent retry (sync engine) returns the same promptId.
    const retry = await api(b, "/chat/prompt", {
      method: "POST",
      token,
      body: { clientRecordId: "rec_1", sessionId: "s1", provider: "openai", model: "gpt-4o", prompt: "Hello", response: "Hi!" },
    });
    expect(retry.body.promptId).toBe(first.body.promptId);

    const history = await api(b, "/chat/history?limit=10", { token });
    expect(history.body.total).toBe(1);
    expect(history.body.records[0]).toMatchObject({ prompt: "Hello", response: "Hi!", tokensUsed: 5, latencyMs: 100 });

    // Records are per-user.
    const { token: otherToken } = await signup(b, "other@example.com");
    const otherHistory = await api(b, "/chat/history?limit=10", { token: otherToken });
    expect(otherHistory.body.total).toBe(0);
  });

  it("respects historyEnabled=false (privacy)", async () => {
    const b = await freshBackend();
    const { token } = await signup(b, "private@example.com");

    await api(b, "/users/me/settings", { method: "PATCH", token, body: { historyEnabled: false } });
    const result = await api(b, "/chat/prompt", {
      method: "POST",
      token,
      body: { clientRecordId: "rec_x", sessionId: "s1", provider: "mock", model: "m", prompt: "secret", response: "r" },
    });
    expect(result.body).toEqual({ recorded: false, reason: "history_disabled" });
    expect((await api(b, "/chat/history", { token })).body.disabled).toBe(true);
  });

  it("marks records for training only after opt-in", async () => {
    const b = await freshBackend();
    const { token } = await signup(b, "train@example.com");

    // No opt-in → not marked.
    const before = await api(b, "/chat/prompt", {
      method: "POST",
      token,
      body: { clientRecordId: "rec_a", sessionId: "s1", provider: "mock", model: "m", prompt: "p", response: "r", forTraining: true },
    });
    expect(before.body.forTraining).toBe(false);

    // Opt in → marked.
    await api(b, "/users/me/settings", { method: "PATCH", token, body: { trainingOptIn: true } });
    const after = await api(b, "/chat/prompt", {
      method: "POST",
      token,
      body: { clientRecordId: "rec_b", sessionId: "s1", provider: "mock", model: "m", prompt: "p2", response: "r2", forTraining: true },
    });
    expect(after.body.forTraining).toBe(true);
  });

  it("collects feedback with and without a prompt", async () => {
    const b = await freshBackend();
    const { token } = await signup(b, "fb@example.com");
    const prompt = await api(b, "/chat/prompt", {
      method: "POST",
      token,
      body: { clientRecordId: "rec_f", sessionId: "s1", provider: "mock", model: "m", prompt: "p", response: "r" },
    });
    const fb = await api(b, "/chat/feedback", { method: "POST", token, body: { promptId: prompt.body.promptId, rating: 5, comment: "great" } });
    expect(fb.status).toBe(201);

    // Feedback-only (promptId omitted) is allowed — "save feedback only" mode.
    const fbOnly = await api(b, "/chat/feedback", { method: "POST", token, body: { rating: 3 } });
    expect(fbOnly.status).toBe(201);

    expect((await api(b, "/chat/feedback", { method: "POST", token, body: { rating: 6 } })).status).toBe(400);
    expect((await api(b, "/chat/feedback", { method: "POST", token, body: { promptId: "pr_nope", rating: 4 } })).status).toBe(404);
  });
});

describe("admin", () => {
  it("enforces admin roles and exposes management data", async () => {
    const b = await freshBackend({ adminEmail: "boss@coder.dev", adminPassword: "adminpass123", adminSuperadmin: true });
    const { token: userToken } = await signup(b, "worker@example.com");
    await api(b, "/chat/prompt", {
      method: "POST",
      token: userToken,
      body: { clientRecordId: "rec_adm", sessionId: "s1", provider: "openai", model: "gpt-5", prompt: "admin sees me", response: "ok" },
    });

    // User → 403.
    expect((await api(b, "/admin/users", { token: userToken })).status).toBe(403);

    const adminLogin = await api(b, "/auth/login", { method: "POST", body: { email: "boss@coder.dev", password: "adminpass123" } });
    const adminToken = adminLogin.body.token as string;

    const users = await api(b, "/admin/users", { token: adminToken });
    expect(users.body.users.length).toBeGreaterThanOrEqual(2);
    expect(users.body.users.some((u: { email: string }) => u.email === "worker@example.com")).toBe(true);

    const prompts = await api(b, "/admin/prompts", { token: adminToken });
    expect(prompts.body.prompts[0]?.prompt).toBe("admin sees me");

    const logs = await api(b, "/admin/logs?limit=50", { token: adminToken });
    const actions = logs.body.logs.map((l: { action: string }) => l.action);
    expect(actions).toContain("auth.signup");
    expect(actions).toContain("auth.login");

    const usage = await api(b, "/admin/usage?days=7", { token: adminToken });
    expect(usage.body.usage.byProvider).toContainEqual({ provider: "openai", count: 1 });

    const training = await api(b, "/admin/training", { token: adminToken });
    expect(training.body).toMatchObject({ optInCount: 0, totalUsers: 2 });
  });

  it("rotates the master key and re-encrypts stored keys", async () => {
    const b = await freshBackend({ adminEmail: "boss@coder.dev", adminPassword: "adminpass123", adminSuperadmin: true });
    const { token } = await signup(b, "rot@example.com");
    await api(b, "/auth/provider-key", { method: "POST", token, body: { provider: "anthropic", apiKey: "sk-ant-rotate-1234567890" } });

    const adminLogin = await api(b, "/auth/login", { method: "POST", body: { email: "boss@coder.dev", password: "adminpass123" } });
    const rotate = await api(b, "/admin/rotate-key", { method: "POST", token: adminLogin.body.token });
    expect(rotate.status).toBe(200);
    expect(rotate.body).toMatchObject({ reencrypted: 1, activeVersion: "v2" });

    const raw = readFileSync(b.ctx.config.dbPath, "utf8");
    expect(raw).not.toContain("sk-ant-rotate-1234567890");

    // The key is still usable: the proxy decrypts it for the provider call.
    const { FakeFetch } = await import("../../helpers/fake-fetch.js");
    const fake = new FakeFetch();
    fake.json("/messages", { id: "msg-1", model: "claude-sonnet-4", content: [{ type: "text", text: "still works" }] });
    const { proxyChat } = await import("../../../backend/src/providers/proxy.js");
    const row = b.ctx.db.raw.prepare("SELECT encrypted_key FROM provider_keys").get() as { encrypted_key: string };
    const decrypted = b.ctx.keyManager.decrypt(row.encrypted_key);
    const response = await proxyChat("anthropic", decrypted, { model: "claude-sonnet-4", messages: [{ role: "user", content: "hi" }] }, fake.fetch);
    expect(response.content).toBe("still works");
  });

  it("requires superadmin for rotation", async () => {
    const b = await freshBackend({ adminEmail: "boss@coder.dev", adminPassword: "adminpass123", adminSuperadmin: false });
    const adminLogin = await api(b, "/auth/login", { method: "POST", body: { email: "boss@coder.dev", password: "adminpass123" } });
    const rotate = await api(b, "/admin/rotate-key", { method: "POST", token: adminLogin.body.token });
    expect(rotate.status).toBe(403);
  });
});

describe("data ownership", () => {
  it("exports a data bundle without plaintext keys", async () => {
    const b = await freshBackend();
    const { token, user } = await signup(b, "export@example.com");
    await api(b, "/auth/provider-key", { method: "POST", token, body: { provider: "openai", apiKey: "sk-export-me-1234567890" } });
    await api(b, "/chat/prompt", { method: "POST", token, body: { clientRecordId: "rec_e", sessionId: "s1", provider: "openai", model: "gpt-4o", prompt: "export me", response: "done" } });

    const result = await api(b, "/export", { method: "POST", token });
    expect(result.status).toBe(200);
    expect(result.body.user.email).toBe("export@example.com");
    expect(result.body.prompts[0]?.prompt).toBe("export me");
    expect(JSON.stringify(result.body)).not.toContain("sk-export-me");
    expect(result.body.providerKeys[0]).toMatchObject({ provider: "openai", fingerprint: fingerprint("sk-export-me-1234567890").slice(0, 16) });
    void user;
  });

  it("deletes the account and cascades all data", async () => {
    const b = await freshBackend();
    const { token } = await signup(b, "bye@example.com");
    await api(b, "/chat/prompt", { method: "POST", token, body: { clientRecordId: "rec_d", sessionId: "s1", provider: "mock", model: "m", prompt: "p", response: "r" } });
    await api(b, "/auth/provider-key", { method: "POST", token, body: { provider: "openai", apiKey: "sk-bye-1234567890" } });

    const del = await api(b, "/delete-account", { method: "POST", token });
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);

    // Token is dead.
    expect((await api(b, "/auth/session", { token })).status).toBe(401);

    const counts = b.ctx.db.raw
      .prepare(
        "SELECT (SELECT COUNT(*) FROM users) u, (SELECT COUNT(*) FROM prompts) p, (SELECT COUNT(*) FROM provider_keys) k, (SELECT COUNT(*) FROM feedback) f",
      )
      .get() as { u: number; p: number; k: number; f: number };
    expect(counts).toEqual({ u: 0, p: 0, k: 0, f: 0 });

    // Audit trail survives (actor id kept, no FK to users).
    const audit = b.ctx.db.raw.prepare("SELECT action FROM audit_logs ORDER BY created_at DESC LIMIT 1").get() as { action: string };
    expect(audit.action).toBe("account.deleted");
  });
});

describe("server-side proxy", () => {
  it("uses the stored encrypted key for provider calls (decrypt in memory)", async () => {
    const b = await freshBackend();
    const { token } = await signup(b, "proxy@example.com");
    await api(b, "/auth/provider-key", { method: "POST", token, body: { provider: "openrouter", apiKey: "sk-or-proxy-1234567890" } });

    // Intercept the provider call the backend would make.
    const { FakeFetch } = await import("../../helpers/fake-fetch.js");
    const fake = new FakeFetch();
    fake.json("/chat/completions", {
      id: "cc-1",
      model: "anthropic/claude-sonnet-4",
      choices: [{ message: { content: "proxied answer" } }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    });

    const { proxyChat } = await import("../../../backend/src/providers/proxy.js");
    const row = b.ctx.db.raw.prepare("SELECT encrypted_key FROM provider_keys WHERE provider = 'openrouter'").get() as { encrypted_key: string };
    const decrypted = b.ctx.keyManager.decrypt(row.encrypted_key);
    expect(decrypted).toBe("sk-or-proxy-1234567890");

    const response = await proxyChat("openrouter", decrypted, {
      model: "anthropic/claude-sonnet-4",
      messages: [{ role: "user", content: "hello" }],
    }, fake.fetch);
    expect(response.content).toBe("proxied answer");
    const req = fake.last()!;
    expect(req.headers.authorization).toBe("Bearer sk-or-proxy-1234567890");
    expect(req.url).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("returns a clear error when no key is stored", async () => {
    const b = await freshBackend();
    const { token } = await signup(b, "nokey@example.com");
    const result = await api(b, "/chat/completions", {
      method: "POST",
      token,
      body: { provider: "openai", model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    });
    expect(result.status).toBe(404);
    expect(result.body.error.code).toBe("no_key");
  });
});

describe("firebase exchange", () => {
  it("returns 501 when Firebase is not configured", async () => {
    const b = await freshBackend();
    const result = await api(b, "/auth/firebase", { method: "POST", body: { idToken: "x" } });
    expect(result.status).toBe(501);
  });
});
