/**
 * Phase 4 unit tests: tasks, MCP, extensions, skills stores.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskQueue } from "../../../src/tasks/queue.js";
import { McpManager } from "../../../src/mcp/manager.js";
import { ExtensionManager } from "../../../src/extensions/manager.js";
import { SkillManager } from "../../../src/skills/manager.js";

let home = "";
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "coder-p4-"));
  process.env.CODER_HOME = home;
});
afterEach(() => {
  delete process.env.CODER_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("task queue", () => {
  it("enqueues, claims and transitions tasks", () => {
    const q = new TaskQueue();
    const task = q.enqueue("build", "compile the project");
    expect(task.status).toBe("queued");
    const claimed = q.claimNext();
    expect(claimed?.id).toBe(task.id);
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempts).toBe(1);
    q.setStatus(task.id, "succeeded", { result: "ok" });
    expect(q.get(task.id)!.status).toBe("succeeded");
    expect(q.stats().succeeded).toBe(1);
  });
  it("cancels queued tasks", () => {
    const q = new TaskQueue();
    const t = q.enqueue("x", "y");
    q.cancel(t.id);
    expect(q.get(t.id)!.status).toBe("cancelled");
  });
});

describe("MCP manager", () => {
  it("adds, discovers, connects and removes servers", async () => {
    const mgr = new McpManager();
    const s = mgr.add({ name: "fs", command: "npx server-fs" });
    expect(s.transport).toBe("stdio");
    const discovered = await mgr.discover(s.id);
    expect(discovered!.tools.length).toBeGreaterThan(0);
    mgr.connect(s.id);
    expect(mgr.get(s.id)!.connected).toBe(true);
    expect(mgr.remove(s.id)).toBe(true);
    expect(mgr.list()).toHaveLength(0);
  });
  it("executes tools only for enabled servers", async () => {
    const mgr = new McpManager();
    const s = mgr.add({ name: "http", url: "http://localhost:9999", transport: "http" });
    mgr.setEnabled(s.id, false);
    const blocked = await mgr.executeTool(s.id, "x");
    expect(blocked.ok).toBe(false);
    mgr.setEnabled(s.id, true);
    const ok = await mgr.executeTool(s.id, "x");
    expect(ok.ok).toBe(true);
  });
});

describe("extension manager", () => {
  it("installs, updates, enables/disables, removes", () => {
    const mgr = new ExtensionManager();
    const ext = mgr.install({ name: "linter", version: "1.0.0", description: "lints" });
    expect(mgr.list()).toHaveLength(1);
    const updated = mgr.update(ext.id, { version: "2.0.0" });
    expect(updated!.manifest.version).toBe("2.0.0");
    mgr.setEnabled(ext.id, false);
    expect(mgr.get(ext.id)!.enabled).toBe(false);
    expect(ExtensionManager.validate({ name: "x", version: "1" })).toBe(true);
    expect(ExtensionManager.validate({ name: "x" })).toBe(false);
    expect(mgr.remove(ext.id)).toBe(true);
  });
});

describe("skill manager", () => {
  it("seeds builtin skills and can create custom ones", () => {
    const mgr = new SkillManager();
    const names = mgr.list().map((s) => s.name);
    expect(names).toContain("react");
    expect(names).toContain("security");
    const custom = mgr.create({ name: "rust", domain: "backend", description: "rust lang", systemPrompt: "write rust" });
    expect(mgr.findByName("rust")!.id).toBe(custom.id);
    const rendered = mgr.render(mgr.findByName("react")!);
    expect(rendered).toContain("Skill: react");
  });
});
