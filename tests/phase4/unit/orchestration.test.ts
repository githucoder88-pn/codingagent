/**
 * Phase 4 unit tests: agent roles, orchestration pipeline, workflows.
 *
 * Uses the offline mock provider (role markers → deterministic completions)
 * against the sample fixture repository.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { useTempHome } from "../../helpers/temp-home.js";
import { WorkspaceManager } from "../../../src/workspace/workspace-manager.js";
import { MockProvider } from "../../../src/providers/mock/mock.provider.js";
import { ProviderRegistry } from "../../../src/providers/registry.js";
import { ModelCache } from "../../../src/providers/model-cache.js";
import { SqliteStore } from "../../../src/session/storage/sqlite-store.js";
import { getAgentRole, listAgentRoles, roleSystemPrompt } from "../../../src/orchestration/roles.js";
import { planTask, orchestrateTask } from "../../../src/orchestration/pipeline.js";
import { WorkflowManager } from "../../../src/orchestration/workflows.js";

useTempHome();

const FIXTURE = resolve(process.cwd(), "tests/fixtures/sample-repo");
let repoDir = "";
let registry: ProviderRegistry;

beforeAll(() => {
  repoDir = mkdtempSync(join(tmpdir(), "coder-orch4-"));
  cpSync(FIXTURE, repoDir, { recursive: true });
  registry = new ProviderRegistry(new ModelCache(new SqliteStore()));
  registry.register(new MockProvider());
});

async function workspace(): Promise<WorkspaceManager> {
  const m = new WorkspaceManager({ root: repoDir });
  await m.ensureIndex();
  return m;
}

describe("agent role registry", () => {
  it("defines the Phase 4 core roles", () => {
    const ids = listAgentRoles().map((r) => r.id);
    for (const id of ["planner", "researcher", "developer", "reviewer", "tester", "security", "documenter", "memory"]) {
      expect(ids).toContain(id);
    }
  });
  it("composes a role system prompt with the role marker", () => {
    const prompt = roleSystemPrompt(getAgentRole("planner")!, "ctx");
    expect(prompt).toContain("CODER AGENT ROLE: planner");
    expect(prompt).toContain("ctx");
  });
  it("restricts tool subsets (tester can shell, planner cannot)", () => {
    const tester = getAgentRole("tester")!;
    const planner = getAgentRole("planner")!;
    expect(tester.tools).toContain("run_tests");
    expect(planner.tools).not.toContain("run_tests");
  });
});

describe("orchestration pipeline (mock provider)", () => {
  it("plans a task into ordered steps", async () => {
    const ws = await workspace();
    const result = await planTask({ task: "add login", workspace: ws, registry, providerId: "mock", model: "mock/coder-1" });
    expect(result.report).toMatch(/Plan:/);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.role.id).toBe("planner");
  });

  it("runs the full orchestrate pipeline through all roles", async () => {
    const ws = await workspace();
    const result = await orchestrateTask({ task: "add feature X", workspace: ws, registry, providerId: "mock", model: "mock/coder-1" });
    expect(result.steps.length).toBeGreaterThanOrEqual(7);
    const roleIds = result.steps.map((s) => s.role.id);
    expect(roleIds).toContain("planner");
    expect(roleIds).toContain("developer");
    expect(roleIds).toContain("reviewer");
    expect(result.report).toContain("Orchestration report");
  });
});

describe("workflows", () => {
  it("seeds builtin workflows and validates role steps", () => {
    const mgr = new WorkflowManager();
    const names = mgr.list().map((w) => w.name);
    expect(names).toContain("full-cycle");
    const fullCycle = mgr.findByName("full-cycle")!;
    const validation = mgr.validate(fullCycle);
    expect(validation.ok).toBe(true);
  });
  it("flags workflows with unknown roles", () => {
    const mgr = new WorkflowManager();
    const wf = mgr.install({ name: "bad", steps: ["planner", "dragon"], description: "x" });
    expect(mgr.validate(wf)).toEqual({ ok: false, missing: ["dragon"] });
  });
});

// cleanup the temp repo at module end (vitest keeps it otherwise)
import { afterAll } from "vitest";
afterAll(() => rmSync(repoDir, { recursive: true, force: true }));
