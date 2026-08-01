/**
 * Phase 3 backend integration: repositories, indexed files, embeddings,
 * search history, checkpoints, patches and admin repository analytics.
 */

import { afterEach, describe, expect, it } from "vitest";
import { startTestBackend, api, signup, type TestBackend } from "../../helpers/backend.js";
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

const VECTOR = Array.from({ length: 16 }, (_, i) => i / 16);

describe("workspace API", () => {
  it("upserts repositories and lists them per-user", async () => {
    const b = await freshBackend();
    const { token } = await signup(b, "ws@example.com");

    const created = await api(b, "/workspace/repositories", {
      method: "POST",
      token,
      body: { path: "/home/me/app", name: "app", language: "typescript", fileCount: 12, symbolCount: 40, lineCount: 900 },
    });
    expect(created.status).toBe(201);
    const repoId = created.body.id as string;

    // Upsert updates, does not duplicate.
    await api(b, "/workspace/repositories", {
      method: "POST",
      token,
      body: { path: "/home/me/app", name: "app", language: "typescript", fileCount: 13, symbolCount: 41, lineCount: 950 },
    });
    const list = await api(b, "/workspace/repositories", { token });
    expect(list.body.repositories).toHaveLength(1);
    expect(list.body.repositories[0]).toMatchObject({ id: repoId, fileCount: 13, symbolCount: 41 });

    // Per-user isolation.
    const { token: otherToken } = await signup(b, "other@example.com");
    expect((await api(b, "/workspace/repositories", { token: otherToken })).body.repositories).toHaveLength(0);

    // Delete.
    const removed = await api(b, `/workspace/repositories/${repoId}`, { method: "DELETE", token });
    expect(removed.status).toBe(200);
    expect((await api(b, "/workspace/repositories", { token })).body.repositories).toHaveLength(0);
  });

  it("stores indexed files and embeddings (replace semantics)", async () => {
    const b = await freshBackend();
    const { token } = await signup(b, "files@example.com");
    const repo = await api(b, "/workspace/repositories", {
      method: "POST",
      token,
      body: { path: "/repo", name: "repo", language: "go" },
    });
    const repoId = repo.body.id as string;

    const files = await api(b, `/workspace/repositories/${repoId}/files`, {
      method: "POST",
      token,
      body: { files: [{ path: "main.go", hash: "abc123", size: 100, language: "go" }] },
    });
    expect(files.status).toBe(200);
    expect(files.body.files).toBe(1);

    const embeddings = await api(b, `/workspace/repositories/${repoId}/embeddings`, {
      method: "POST",
      token,
      body: { model: "coder-local-hash-v1", embeddings: [{ path: "main.go", vector: VECTOR }] },
    });
    expect(embeddings.status).toBe(200);
    expect(embeddings.body.embeddings).toBe(1);

    // Replace semantics: second upload replaces the first.
    await api(b, `/workspace/repositories/${repoId}/files`, {
      method: "POST",
      token,
      body: { files: [{ path: "other.go", hash: "def456", size: 50 }] },
    });
    const rows = b.ctx.db.raw.prepare("SELECT path FROM indexed_files WHERE repository_id = ?").all(repoId) as Array<{ path: string }>;
    expect(rows.map((r) => r.path)).toEqual(["other.go"]);
  });

  it("records search history, checkpoints and patches", async () => {
    const b = await freshBackend();
    const { token } = await signup(b, "hist@example.com");

    const search = await api(b, "/workspace/search-history", {
      method: "POST",
      token,
      body: { query: "authentication", kind: "symbol", resultCount: 3 },
    });
    expect(search.status).toBe(201);

    const checkpoint = await api(b, "/workspace/checkpoints", {
      method: "POST",
      token,
      body: { name: "cp-1", fileCount: 5 },
    });
    expect(checkpoint.status).toBe(201);

    const patch = await api(b, "/workspace/patches", {
      method: "POST",
      token,
      body: { summary: "fix auth", diff: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n" },
    });
    expect(patch.status).toBe(201);

    const summary = await api(b, "/workspace", { token });
    expect(summary.body.searchHistory).toHaveLength(1);
    expect(summary.body.searchHistory[0]).toMatchObject({ query: "authentication", kind: "symbol", resultCount: 3 });
    expect(summary.body.checkpoints[0]?.name).toBe("cp-1");
    expect(summary.body.patches[0]?.summary).toBe("fix auth");
    expect(summary.body.patches[0]?.diffLength).toBeGreaterThan(10);

    // Delete the checkpoint.
    const deleted = await api(b, `/workspace/checkpoints/${checkpoint.body.id}`, { method: "DELETE", token });
    expect(deleted.status).toBe(200);
    expect((await api(b, "/workspace", { token })).body.checkpoints).toHaveLength(0);
  });

  it("records agent runs (failure reports) and surfaces them in analytics", async () => {
    const b = await freshBackend({ adminEmail: "boss@coder.dev", adminPassword: "adminpass123", adminSuperadmin: true });
    const { token } = await signup(b, "agent@example.com");

    await api(b, "/workspace/agent-runs", {
      method: "POST",
      token,
      body: { task: "fix errors", toolCalls: 5, failures: 0, durationMs: 1200, finished: true },
    });
    await api(b, "/workspace/agent-runs", {
      method: "POST",
      token,
      body: { task: "add auth", toolCalls: 8, failures: 2, durationMs: 3000, finished: false },
    });

    const login = await api(b, "/auth/login", { method: "POST", body: { email: "boss@coder.dev", password: "adminpass123" } });
    const analytics = await api(b, "/admin/workspace", { token: login.body.token });
    expect(analytics.body.totals.agent_runs).toBe(2);
    expect(analytics.body.failures).toEqual({ totalRuns: 2, failedRuns: 1, failureCount: 2 });
    expect(analytics.body.performance.avgDurationMs).toBe(2100);
    expect(analytics.body.performance.maxDurationMs).toBe(3000);
  });

  it("requires auth for the workspace API", async () => {
    const b = await freshBackend();
    expect((await api(b, "/workspace/repositories", { method: "POST", body: { path: "x", name: "x" } })).status).toBe(401);
    expect((await api(b, "/workspace")).status).toBe(401);
  });
});

describe("admin repository analytics", () => {
  it("reports language rollups and totals, gated to admins", async () => {
    const b = await freshBackend({ adminEmail: "boss@coder.dev", adminPassword: "adminpass123", adminSuperadmin: true });
    const { token } = await signup(b, "worker@example.com");
    const r1 = await api(b, "/workspace/repositories", {
      method: "POST",
      token,
      body: { path: "/r1", name: "r1", language: "typescript", fileCount: 10 },
    });
    await api(b, "/workspace/repositories", {
      method: "POST",
      token,
      body: { path: "/r2", name: "r2", language: "python", fileCount: 4 },
    });
    await api(b, `/workspace/repositories/${r1.body.id}/files`, {
      method: "POST",
      token,
      body: { files: [{ path: "main.ts", hash: "abc", size: 10 }] },
    });

    // User → 403.
    expect((await api(b, "/admin/workspace", { token })).status).toBe(403);

    const login = await api(b, "/auth/login", { method: "POST", body: { email: "boss@coder.dev", password: "adminpass123" } });
    const analytics = await api(b, "/admin/workspace", { token: login.body.token });
    expect(analytics.status).toBe(200);
    expect(analytics.body.repositories).toEqual(
      expect.arrayContaining([
        { language: "typescript", count: 1, files: 10 },
        { language: "python", count: 1, files: 4 },
      ]),
    );
    expect(analytics.body.totals).toMatchObject({ repos: 2, files: 1, embeddings: 0, patches: 0, searches: 0 });
  });
});
