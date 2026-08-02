/**
 * Phase 9 unit tests: civilization directors, allocation, run loop.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { useTempHome } from "../../helpers/temp-home.js";
import { WorkspaceManager } from "../../../src/workspace/workspace-manager.js";
import { MockProvider } from "../../../src/providers/mock/mock.provider.js";
import { ProviderRegistry } from "../../../src/providers/registry.js";
import { ModelCache } from "../../../src/providers/model-cache.js";
import { SqliteStore } from "../../../src/session/storage/sqlite-store.js";
import { listDirectors, getDirector, allocateDirectors, directorRole } from "../../../src/civilization/directors.js";
import { runCivilization } from "../../../src/civilization/run.js";

useTempHome();

const FIXTURE = resolve(process.cwd(), "tests/fixtures/sample-repo");
let repoDir = "";
let registry: ProviderRegistry;
beforeAll(() => {
  repoDir = mkdtempSync(join(tmpdir(), "coder-civ9-"));
  cpSync(FIXTURE, repoDir, { recursive: true });
  registry = new ProviderRegistry(new ModelCache(new SqliteStore()));
  registry.register(new MockProvider());
});
afterAll(() => rmSync(repoDir, { recursive: true, force: true }));

async function workspace(): Promise<WorkspaceManager> {
  const m = new WorkspaceManager({ root: repoDir });
  await m.ensureIndex();
  return m;
}

describe("civilization directors", () => {
  it("registers the executive + department directors", () => {
    const ids = listDirectors().map((d) => d.id);
    for (const id of ["executive", "architect", "research", "engineering", "security", "infra", "docs", "quality"]) {
      expect(ids).toContain(id);
    }
  });
  it("resolves aliases and backs each director with an agent role", () => {
    const docs = getDirector("documentation")!;
    expect(docs.id).toBe("docs");
    expect(directorRole(docs)).toBeDefined();
  });
  it("allocates layers by keyword (security goals summon security)", () => {
    const allocated = allocateDirectors("harden the authentication and deploy to kubernetes");
    const ids = allocated.map((d) => d.id);
    expect(ids).toContain("executive");
    expect(ids).toContain("security");
    expect(ids).toContain("infra"); // deploy/kubernetes
    expect(ids).toContain("engineering"); // always included
  });
});

describe("civilization run loop", () => {
  it("runs a goal and produces an evaluation", async () => {
    const ws = await workspace();
    const result = await runCivilization({ goal: "fix the auth bug and add tests", workspace: ws, registry, providerId: "mock", model: "mock/coder-1" });
    expect(result.allocated.length).toBeGreaterThan(0);
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.evaluation.score).toBeGreaterThanOrEqual(0);
    expect(result.knowledgeRecorded).toBeGreaterThanOrEqual(0);
  });
});
