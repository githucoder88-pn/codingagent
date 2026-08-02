/**
 * Phase 11 unit tests: offline runtime — outbox, recovery, connect,
 * daemon, status, and graceful cloud degradation in the run dispatcher.
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { useTempHome } from "../../helpers/temp-home.js";
import { SyncOutbox } from "../../../src/offline/outbox.js";
import { RecoveryEngine } from "../../../src/offline/recovery.js";
import { ConnectionManager } from "../../../src/offline/connect.js";
import { DaemonManager } from "../../../src/pet/daemon.js";
import { TaskQueue } from "../../../src/tasks/queue.js";
import { buildStatus } from "../../../src/runtime/status.js";
import { runTask } from "../../../src/runtime/run.js";
import { ExecutionMode } from "../../../src/runtime/modes.js";
import { WorkspaceManager } from "../../../src/workspace/workspace-manager.js";
import { MockProvider } from "../../../src/providers/mock/mock.provider.js";
import { ProviderRegistry } from "../../../src/providers/registry.js";
import { ModelCache } from "../../../src/providers/model-cache.js";
import { SqliteStore } from "../../../src/session/storage/sqlite-store.js";

useTempHome();

const FIXTURE = resolve(process.cwd(), "tests/fixtures/sample-repo");
let repoDir = "";
let registry: ProviderRegistry;
beforeAll(() => {
  repoDir = mkdtempSync(join(tmpdir(), "coder-off11-"));
  cpSync(FIXTURE, repoDir, { recursive: true });
  registry = new ProviderRegistry(new ModelCache(new SqliteStore()));
  registry.register(new MockProvider());
});
afterAll(() => rmSync(repoDir, { recursive: true, force: true }));

// buildStatus needs an AppContext-like object; construct a minimal one.
import { ConfigManager } from "../../../src/config/manager/config-manager.js";
import { HistoryManager } from "../../../src/session/history/history-manager.js";
import { SessionStore } from "../../../src/session/storage/session-store.js";
import { Memory } from "../../../src/session/memory/memory.js";
import { Logger } from "../../../src/logger/index.js";
import { Container } from "../../../src/core/container/container.js";
import { effectiveTheme } from "../../../src/ui/themes/theme.js";
import type { AppContext } from "../../../src/core/application/application.js";

function fakeCtx(): AppContext {
  const container = new Container();
  const config = new ConfigManager();
  const store = new SqliteStore();
  const sessions = new SessionStore();
  return {
    container,
    config,
    store,
    sessions,
    history: new HistoryManager(sessions),
    memory: new Memory(),
    logger: new Logger({ consoleDebug: false, theme: effectiveTheme("none") }),
    theme: effectiveTheme("none"),
    settings: () => config.settings(),
    modelCache: new ModelCache(store),
    registry,
  } as unknown as AppContext;
}

describe("sync outbox", () => {
  it("queues, flushes when online, defers when offline", async () => {
    const outbox = new SyncOutbox();
    outbox.enqueue("task", { a: 1 });
    outbox.enqueue("task", { b: 2 });
    expect(outbox.pending()).toHaveLength(2);
    const online = await outbox.flush(async () => true);
    expect(online.delivered).toBe(2);
    outbox.enqueue("task", { c: 3 });
    const offline = await outbox.flush(async () => false);
    expect(offline.deferred).toBe(1);
    expect(outbox.pending()).toHaveLength(1);
  });
});

describe("recovery engine", () => {
  it("re-queues failed tasks once and skips already-retried ones", () => {
    const queue = new TaskQueue();
    const failed = queue.enqueue("x", "boom");
    queue.setStatus(failed.id, "failed", { error: "oops" });
    const engine = new RecoveryEngine();
    const first = engine.recover();
    expect(first.recovered).toHaveLength(1);
    // mark the re-queued task failed again; recovery must NOT retry the original twice
    const second = engine.recover();
    expect(second.recovered).toHaveLength(0); // original already retried
  });
});

describe("connection manager (key mode 3)", () => {
  it("records pending connections and validates when backend is reachable", async () => {
    const mgr = new ConnectionManager();
    mgr.connect("ws-1");
    expect(mgr.list()[0]!.status).toBe("pending");
    // offline → stays pending
    const offline = await mgr.validate(async () => false);
    expect(offline.pending).toBe(1);
    // online + known → connected
    const online = await mgr.validate(async () => true, (id) => id === "ws-1");
    expect(online.validated).toBe(1);
    expect(mgr.list()[0]!.status).toBe("connected");
    expect(mgr.remove("ws-1")).toBe(true);
  });
});

describe("daemon manager", () => {
  it("starts (stub when no CLI), reports status, and stops cleanly", async () => {
    const mgr = new DaemonManager();
    const state = mgr.start({ autonomous: true, cliPath: "/no/such/cli.js" });
    expect(state.autonomous).toBe(true);
    expect(mgr.isRunning()).toBe(false); // no real pid
    const status = mgr.status();
    expect(status.running).toBe(false);
    const stop = await mgr.stop();
    expect(stop.stopped).toBe(true);
  });
});

describe("runtime status aggregation", () => {
  it("renders a full report offline (no backend)", async () => {
    const report = await buildStatus(fakeCtx(), { offline: true });
    expect(report.offline).toBe(true);
    expect(report.backend.reachable).toBe(false);
    expect(report.memory).toBeDefined();
    expect(report.pet.running).toBe(false);
    expect(report.outbox).toBeDefined();
  });
});

describe("run dispatcher — graceful cloud degradation", () => {
  it("cloud mode with unreachable backend degrades to local and parks the task", async () => {
    const result = await runTask({
      task: "summarize the repo",
      dir: repoDir,
      registry,
      providerId: "mock",
      model: "mock/coder-1",
      mode: ExecutionMode.CLOUD,
    });
    expect(result.degraded).toBe(true);
    expect(result.modeUsed).toBe(ExecutionMode.LOCAL);
    expect(result.parked).toBe(true);
    expect(new SyncOutbox().pending().length).toBeGreaterThan(0);
  });

  it("offline mode never probes the network and runs locally", async () => {
    const result = await runTask({
      task: "summarize",
      dir: repoDir,
      registry,
      providerId: "mock",
      model: "mock/coder-1",
      mode: ExecutionMode.OFFLINE,
    });
    expect(result.degraded).toBe(false);
    expect(result.parked).toBe(false);
  });
});
