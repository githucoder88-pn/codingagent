/**
 * Phase 7 unit tests: cognitive core, evolve loop, research engine.
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
import { cognitive } from "../../../src/cognitive/core.js";
import { evolveTask, researchTopic } from "../../../src/cognitive/loops.js";

useTempHome();

const FIXTURE = resolve(process.cwd(), "tests/fixtures/sample-repo");
let repoDir = "";
let registry: ProviderRegistry;

beforeAll(() => {
  repoDir = mkdtempSync(join(tmpdir(), "coder-cog7-"));
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

describe("cognitive core", () => {
  it("starts at a sensible risk threshold and adapts on outcomes", () => {
    const core = cognitive();
    const before = core.snapshot().riskThreshold;
    core.adapt("success");
    expect(core.snapshot().riskThreshold).toBeLessThan(before); // success lowers risk
    const mid = core.snapshot().riskThreshold;
    core.adapt("failure");
    expect(core.snapshot().riskThreshold).toBeGreaterThan(mid); // failure raises risk
  });

  it("reflects outcomes into memory + lessons and predicts", () => {
    const core = cognitive();
    core.reflect("success", "shipped feature login", ["login works"]);
    const snap = core.snapshot();
    expect(snap.reflections[0]!.outcome).toBe("success");
    expect(snap.lessons).toContain("login works");
    const conf = core.predict("implement login");
    expect(conf).toBeGreaterThan(0);
    expect(conf).toBeLessThanOrEqual(0.99);
  });

  it("updates the world model from a scanned workspace", async () => {
    const ws = await workspace();
    const core = cognitive();
    core.updateWorldModel(ws);
    const snap = core.snapshot();
    expect(snap.worldModel.entities).toBeGreaterThan(0);
    expect(snap.worldModel.lastRoot).toBe(repoDir);
  });

  it("plans and evaluates through the mock provider", async () => {
    const core = cognitive();
    const steps = await core.plan(registry, "mock", "mock/coder-1", "add tests");
    expect(steps.length).toBeGreaterThan(0);
    const evalResult = await core.evaluate(registry, "mock", "mock/coder-1", "add tests", "done");
    expect(evalResult.score).toBeGreaterThanOrEqual(0);
    expect(evalResult.score).toBeLessThanOrEqual(1);
  });
});

describe("evolve loop", () => {
  it("runs observe→…→learn and tunes the risk threshold", async () => {
    const ws = await workspace();
    const core = cognitive();
    const before = core.snapshot().riskThreshold;
    const result = await evolveTask({ task: "add a login form", workspace: ws, registry, providerId: "mock", model: "mock/coder-1" });
    expect(result.steps.length).toBeGreaterThan(0);
    expect(["success", "failure"]).toContain(result.outcome);
    expect(result.riskThresholdAfter).not.toBe(before);
  });
});

describe("research engine", () => {
  it("surveys symbols, files and synthesises a summary", async () => {
    const ws = await workspace();
    const result = await researchTopic({ topic: "authenticate", workspace: ws, registry, providerId: "mock", model: "mock/coder-1" });
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.symbols.length + result.files.length).toBeGreaterThan(0);
  });
});
