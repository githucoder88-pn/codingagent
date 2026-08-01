/**
 * Phase 3 integration tests: the workspace intelligence layer against the
 * sample fixture repository — scanning, indexing, search, embeddings,
 * tools, checkpoints, undo/redo and the agent loop.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WorkspaceManager } from "../../../src/workspace/workspace-manager.js";
import { ExecutionScheduler } from "../../../src/execution/scheduler.js";
import { RollbackManager } from "../../../src/execution/rollback.js";
import { runAgent } from "../../../src/execution/agent.js";
import { MockProvider } from "../../../src/providers/mock/mock.provider.js";
import { ProviderRegistry } from "../../../src/providers/registry.js";
import { ModelCache } from "../../../src/providers/model-cache.js";
import { SqliteStore } from "../../../src/session/storage/sqlite-store.js";
import { useTempHome } from "../../helpers/temp-home.js";
import type { Provider } from "../../../src/providers/base/provider.interface.js";

useTempHome();

const FIXTURE = resolve(process.cwd(), "tests/fixtures/sample-repo");

let repoDir = "";

beforeAll(() => {
  // Copy the fixture to a writable temp dir so tools can mutate it.
  repoDir = mkdtempSync(join(tmpdir(), "coder-ws-"));
  const { cpSync } = require("node:fs") as typeof import("node:fs");
  cpSync(FIXTURE, repoDir, { recursive: true });
});

async function manager(): Promise<WorkspaceManager> {
  const m = new WorkspaceManager({ root: repoDir });
  await m.ensureIndex();
  return m;
}

describe("repository scan + index", () => {
  it("scans the fixture with correct statistics", async () => {
    const m = await manager();
    const index = m.indexOrNull!;
    expect(index.stats.language).toBe("typescript");
    expect(index.stats.sourceFiles).toBe(6); // 4 ts + py + go
    expect(index.stats.directories).toBeGreaterThanOrEqual(3);
    expect(index.files.length).toBe(6);
    // Functions from TS files + python + go.
    expect(index.stats.functions).toBeGreaterThanOrEqual(8);
    expect(index.stats.classes).toBeGreaterThanOrEqual(2); // AuthService + ConfigManager + Service
    expect(index.stats.interfaces).toBeGreaterThanOrEqual(1); // User
    expect(index.stats.imports).toBeGreaterThanOrEqual(3);
    expect(index.stats.tests).toBeGreaterThanOrEqual(1);
  });

  it("caches the index and reuses it", async () => {
    const a = await new WorkspaceManager({ root: repoDir }).ensureIndex();
    const b = await new WorkspaceManager({ root: repoDir, useCache: true }).ensureIndex();
    expect(b.scannedAt).toBe(a.scannedAt);
  });

  it("indexes python and go via tree-sitter", async () => {
    const m = await manager();
    const py = m.indexOrNull!.files.find((f) => f.path === "python_util.py");
    expect(py?.symbols.map((s) => s.name)).toEqual(expect.arrayContaining(["parse_config", "ConfigManager"]));
    const go = m.indexOrNull!.files.find((f) => f.path === "go_util.go");
    expect(go?.symbols.map((s) => s.name)).toEqual(expect.arrayContaining(["ComputeHash", "Service"]));
  });
});

describe("search engine", () => {
  it("finds symbol definitions and references", async () => {
    const m = await manager();
    const engine = m.search();
    const defs = engine.findDefinition("hashPassword");
    expect(defs.length).toBeGreaterThanOrEqual(1);
    expect(defs[0]?.file).toBe("src/utils.ts");

    const refs = engine.findReference("hashPassword");
    expect(refs.some((r) => r.file === "src/index.ts")).toBe(true);

    const symbols = engine.searchSymbols("authenticate");
    expect(symbols.some((s) => s.symbol?.name === "authenticate")).toBe(true);
  });

  it("finds imports, related code and tests", async () => {
    const m = await manager();
    const engine = m.search();
    expect(engine.findImports("./auth").map((i) => i.file)).toContain("src/index.ts");
    const related = engine.findRelatedCode("src/auth.ts");
    expect(related.some((r) => r.relation === "imported-by" && r.path === "src/index.ts")).toBe(true);
    expect(engine.findTests("src/auth.ts")).toContain("test/auth.test.ts");
    expect(engine.findExports("src/utils.ts")).toEqual(expect.arrayContaining(["hashPassword", "formatToken", "VERSION"]));
  });

  it("searches content with line numbers", async () => {
    const m = await manager();
    const hits = m.search().searchContent("AuthService", { maxResults: 10 });
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0]?.line).toBeGreaterThan(0);
    expect(hits[0]?.snippet).toContain("AuthService");
  });

  it("finds files by name pattern", async () => {
    const m = await manager();
    expect(m.search().searchFiles("util")).toEqual(expect.arrayContaining(["src/utils.ts"]));
  });
});

describe("embeddings + context", () => {
  it("computes embeddings and finds semantic neighbors", async () => {
    const m = await manager();
    await m.ensureIndex();
    const similar = m.embeddings.relatedTo(repoDir, "src/auth.ts", 3);
    expect(similar.length).toBeGreaterThan(0);
    expect(similar[0]!.score).toBeGreaterThan(0.1);
  });

  it("builds a context bundle with git, docs and dependencies", async () => {
    const m = await manager();
    const bundle = await m.context().build({ includeGit: true });
    expect(bundle.structure).toContain("src/index.ts");
    expect(bundle.docs.some((d) => d.includes("Sample repository"))).toBe(true);
    expect(bundle.dependencies.edges).toBeGreaterThan(0);
    expect(bundle.git.isRepo).toBe(false); // fixture is not a git repo
    expect(bundle.stats.functions).toBeGreaterThan(0);
  });
});

describe("move_file tool", () => {
  it("moves a file within the workspace", async () => {
    const scheduler = new ExecutionScheduler({ cwd: repoDir, level: "full-auto" });
    await scheduler.execute("write_file", { path: "move-me.txt", content: "move" });
    const moved = await scheduler.execute("move_file", { from: "move-me.txt", to: "moved.txt" });
    expect(moved.ok).toBe(true);
    expect(existsSync(join(repoDir, "move-me.txt"))).toBe(false);
    expect(existsSync(join(repoDir, "moved.txt"))).toBe(true);
    expect(readFileSync(join(repoDir, "moved.txt"), "utf8")).toBe("move");
  });
});

describe("filesystem + execution tools", () => {
  it("reads, writes, replaces and lists files within the workspace", async () => {
    const scheduler = new ExecutionScheduler({ cwd: repoDir, level: "full-auto" });
    const written = await scheduler.execute("write_file", { path: "notes.md", content: "hello\n" });
    expect(written.ok).toBe(true);
    const read = await scheduler.execute("read_file", { path: "notes.md" });
    expect(read.output).toContain("hello");
    const replaced = await scheduler.execute("replace_text", { path: "notes.md", find: "hello", replace: "world" });
    expect(replaced.ok).toBe(true);
    expect(readFileSync(join(repoDir, "notes.md"), "utf8")).toBe("world\n");
    const listed = await scheduler.execute("list_directory", { dir: "." });
    expect(listed.output).toContain("notes.md");
  });

  it("confines paths to the workspace root", async () => {
    const scheduler = new ExecutionScheduler({ cwd: repoDir, level: "full-auto" });
    const result = await scheduler.execute("write_file", { path: "../escape.txt", content: "x" });
    expect(result.ok).toBe(false);
  });

  it("enforces permission levels", async () => {
    const safe = new ExecutionScheduler({ cwd: repoDir, level: "safe" });
    const denied = await safe.execute("write_file", { path: "x.txt", content: "x" });
    expect(denied.ok).toBe(false);
    expect(denied.error).toContain("Permission denied");

    const deniedShell = await safe.execute("execute_command", { command: "ls" });
    expect(deniedShell.ok).toBe(false);
  });

  it("undo deletes new files and restores edited ones; redo re-applies", async () => {
    const scheduler = new ExecutionScheduler({ cwd: repoDir, level: "full-auto" });

    // New file.
    const created = await scheduler.execute("write_file", { path: "undo-me.md", content: "v1" });
    expect(created.ok).toBe(true);
    expect(existsSync(join(repoDir, "undo-me.md"))).toBe(true);

    // Edit an existing file.
    const original = readFileSync(join(repoDir, "src/utils.ts"), "utf8");
    await scheduler.execute("replace_text", { path: "src/utils.ts", find: "VERSION", replace: "VERSION_EDITED" });

    const undone = scheduler.undo();
    expect(undone?.record.tool).toBe("replace_text");
    expect(readFileSync(join(repoDir, "src/utils.ts"), "utf8")).toBe(original);

    const undone2 = scheduler.undo();
    expect(undone2?.record.tool).toBe("write_file");
    expect(existsSync(join(repoDir, "undo-me.md"))).toBe(false);

    // Redo restores the new file.
    scheduler.redo();
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(repoDir, "undo-me.md"))).toBe(true);
  });
});

describe("shell + git tools", () => {
  it("executes commands with captured output", async () => {
    const scheduler = new ExecutionScheduler({ cwd: repoDir, level: "full-auto" });
    const result = await scheduler.execute("execute_command", { command: "echo hello-from-tool" });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("hello-from-tool");
  });

  it("denies destructive commands through the sandbox", async () => {
    const scheduler = new ExecutionScheduler({ cwd: repoDir, level: "full-auto" });
    const result = await scheduler.execute("execute_command", { command: "rm -rf /" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("denied");
  });

  it("runs git tools in a git repository", async () => {
    const gitDir = mkdtempSync(join(tmpdir(), "coder-git-"));
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    execFileSync("git", ["init", "-q"], { cwd: gitDir });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: gitDir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: gitDir });
    writeFileSync(join(gitDir, "a.txt"), "one");
    execFileSync("git", ["add", "-A"], { cwd: gitDir });
    execFileSync("git", ["commit", "-qm", "init"], { cwd: gitDir });
    writeFileSync(join(gitDir, "a.txt"), "two");

    const scheduler = new ExecutionScheduler({ cwd: gitDir, level: "full-auto" });
    const status = await scheduler.execute("git_status", {});
    expect(status.output).toContain("a.txt");
    const diff = await scheduler.execute("git_diff", {});
    expect(diff.output).toContain("-one");
    expect(diff.output).toContain("+two");
    const commit = await scheduler.execute("git_commit", { message: "update" });
    expect(commit.ok).toBe(true);
    const log = await scheduler.execute("git_log", { count: 3 });
    expect(log.output).toContain("update");
    rmSync(gitDir, { recursive: true, force: true });
  });
});

describe("checkpoints", () => {
  it("creates, lists, restores and deletes checkpoints", async () => {
    const m = await manager();
    const files = m.indexOrNull!.files.map((f) => f.path);
    writeFileSync(join(repoDir, "src/utils.ts"), "// modified\n");

    const { id } = RollbackManager.createCheckpoint(repoDir, "pre-test", files);
    const list = RollbackManager.listCheckpoints(repoDir);
    expect(list.some((c) => c.id === id)).toBe(true);

    // Modify again, then restore.
    writeFileSync(join(repoDir, "src/utils.ts"), "// modified twice\n");
    const restored = RollbackManager.restoreCheckpoint(repoDir, id);
    expect(restored).toContain("src/utils.ts");
    expect(readFileSync(join(repoDir, "src/utils.ts"), "utf8")).toBe("// modified\n");

    expect(RollbackManager.deleteCheckpoint(repoDir, id)).toBe(true);
    expect(RollbackManager.listCheckpoints(repoDir).some((c) => c.id === id)).toBe(false);
  });
});

describe("agent loop", () => {
  it("executes a scripted tool sequence and finishes with an answer", async () => {
    const m = new WorkspaceManager({ root: repoDir });
    await m.ensureIndex();

    // A scripted provider: first call → tool call, second → final answer.
    const scripted: Provider = {
      id: "scripted",
      name: "Scripted",
      defaultModel: "s1",
      requiresKey: false,
      async initialize() {},
      async authenticate() {
        return true;
      },
      async listModels() {
        return [];
      },
      async chat(request) {
        const hasToolTurn = request.messages.some((msg) => msg.role === "user" && msg.content.startsWith("Tool result"));
        return {
          id: "r1",
          model: "s1",
          content: hasToolTurn
            ? "Done — repository analyzed."
            : '```json\n{"tool":"files","params":{}}\n```',
          usage: {},
          createdAt: new Date().toISOString(),
        };
      },
      async *stream() {},
    };

    const store = new SqliteStore();
    const registry = new ProviderRegistry(new ModelCache(store));
    registry.register(scripted);
    const scheduler = new ExecutionScheduler({ cwd: repoDir, level: "safe" });

    const steps: string[] = [];
    const result = await runAgent({
      task: "Analyze the repository.",
      workspace: m,
      registry,
      providerId: "scripted",
      model: "s1",
      scheduler,
      onStep: (step) => steps.push(step.kind === "tool" ? `tool:${step.toolId}` : "answer"),
    });

    expect(result.finished).toBe(true);
    expect(result.toolCalls).toBe(1);
    expect(steps).toEqual(["tool:files", "answer"]);
    expect(result.answer).toContain("repository analyzed");
    await store.close();
  });

  it("stops when the iteration budget is exhausted", async () => {
    const m = new WorkspaceManager({ root: repoDir });
    await m.ensureIndex();
    const mock = new MockProvider();
    const looping: Provider = {
      id: "looper",
      name: "Looper",
      defaultModel: "l1",
      requiresKey: false,
      initialize: () => mock.initialize(),
      authenticate: (k) => mock.authenticate(k),
      listModels: () => mock.listModels(),
      async chat() {
        return {
          id: "r",
          model: "l1",
          content: '```json\n{"tool":"git_status","params":{}}\n```',
          usage: {},
          createdAt: new Date().toISOString(),
        };
      },
      async *stream() {},
    };
    const store = new SqliteStore();
    const registry = new ProviderRegistry(new ModelCache(store));
    registry.register(looping);
    const scheduler = new ExecutionScheduler({ cwd: repoDir, level: "safe" });
    const result = await runAgent({
      task: "loop forever",
      workspace: m,
      registry,
      providerId: "looper",
      model: "l1",
      scheduler,
      maxIterations: 3,
    });
    expect(result.finished).toBe(false);
    expect(result.answer).toContain("budget");
    await store.close();
  });
});
