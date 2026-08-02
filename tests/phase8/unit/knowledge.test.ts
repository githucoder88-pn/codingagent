/**
 * Phase 8 unit tests: knowledge graph + model intelligence.
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
import { KnowledgeGraph } from "../../../src/knowledge/graph.js";
import { ModelRouter, classifyModel, estimateCost } from "../../../src/providers/router.js";

useTempHome();

const FIXTURE = resolve(process.cwd(), "tests/fixtures/sample-repo");
let repoDir = "";
let registry: ProviderRegistry;
beforeAll(() => {
  repoDir = mkdtempSync(join(tmpdir(), "coder-k8-"));
  cpSync(FIXTURE, repoDir, { recursive: true });
  registry = new ProviderRegistry(new ModelCache(new SqliteStore()));
  registry.register(new MockProvider());
});
afterAll(() => rmSync(repoDir, { recursive: true, force: true }));

async function indexed(): Promise<WorkspaceManager> {
  const m = new WorkspaceManager({ root: repoDir });
  await m.ensureIndex();
  return m;
}

describe("knowledge graph", () => {
  it("rebuilds from a repository index and reinforces on re-observation", async () => {
    const ws = await indexed();
    const graph = new KnowledgeGraph();
    const first = graph.rebuildFromIndex(ws.indexOrNull!);
    expect(first.added).toBeGreaterThan(0);
    const second = graph.rebuildFromIndex(ws.indexOrNull!);
    expect(second.reinforced).toBeGreaterThan(0); // weight bumps
  });

  it("records goals/lessons and ranks search by weight", () => {
    const graph = new KnowledgeGraph();
    graph.record("goal", "ship offline runtime");
    graph.record("lesson", "never hardcode version");
    const stats = graph.stats();
    expect(stats.entities).toBeGreaterThanOrEqual(2);
    const results = graph.search("offline");
    expect(results.some((e) => e.name.includes("offline"))).toBe(true);
  });
});

describe("model intelligence", () => {
  it("classifies models by family", () => {
    expect(classifyModel("text-embedding-3")).toBe("embedding");
    expect(classifyModel("o1-preview")).toBe("reasoning");
    expect(classifyModel("deepseek-coder")).toBe("code");
    expect(classifyModel("gpt-4o")).toBe("chat");
  });
  it("estimates cost monotonically with tokens", () => {
    const small = estimateCost("gpt-4o-mini", 100, 50);
    const big = estimateCost("gpt-4o-mini", 10000, 5000);
    expect(big).toBeGreaterThan(small);
    expect(small).toBeGreaterThan(0);
  });
  it("router lists candidates and routes by cost", () => {
    const router = new ModelRouter(registry);
    const candidates = router.candidates();
    expect(candidates.length).toBeGreaterThan(0);
    const routed = router.route("chat");
    expect(routed).toBeDefined();
  });
  it("benchmarks a model (mock → ok, finite latency)", async () => {
    const router = new ModelRouter(registry);
    const r = await router.benchmark("mock", "mock/coder-1");
    expect(r.ok).toBe(true);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
