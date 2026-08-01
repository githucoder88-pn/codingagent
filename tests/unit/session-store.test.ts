import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { SessionStore } from "../../src/session/storage/session-store.js";
import { HistoryManager } from "../../src/session/history/history-manager.js";
import { SessionError } from "../../src/core/errors/index.js";
import { useTempHome } from "../helpers/temp-home.js";

useTempHome();

describe("SessionStore", () => {
  it("creates sessions with sequential ids", () => {
    const store = new SessionStore();
    const a = store.create("mock", "mock/coder-1");
    const b = store.create("mock", "mock/coder-2");
    expect(a.id).toBe("session-001");
    expect(b.id).toBe("session-002");
    expect(a.createdAt).toBe(a.updatedAt);
  });

  it("persists and reloads sessions with messages", () => {
    const store = new SessionStore();
    let session = store.create("mock", "mock/coder-1");
    session = store.addMessage(session, { role: "user", content: "hi" });
    session = store.addMessage(session, { role: "assistant", content: "hello!" });

    const loaded = store.load(session.id);
    expect(loaded?.messages).toHaveLength(2);
    expect(loaded?.messages[1]?.content).toBe("hello!");
    if (!loaded) throw new Error("session did not persist");
    expect(loaded.updatedAt >= session.updatedAt).toBe(true);
  });

  it("lists sessions newest-first with metadata", async () => {
    const store = new SessionStore();
    let a = store.create("mock", "m1");
    await new Promise((r) => setTimeout(r, 5));
    const b = store.create("mock", "m2");
    await new Promise((r) => setTimeout(r, 5));
    a = store.addMessage(a, { role: "user", content: "x" });
    const list = store.list();
    expect(list.map((m) => m.id)).toEqual([a.id, b.id]);
    expect(list[0]).toMatchObject({ messageCount: 1, model: "m1" });
    expect(list[1]).toMatchObject({ messageCount: 0 });
  });

  it("rejects corrupt session files", () => {
    const store = new SessionStore();
    store.create("mock", "m1");
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(`${process.env.CODER_HOME}/sessions/session-001.json`, "{ nope");
    expect(() => store.load("session-001")).toThrow(SessionError);
  });

  it("removes sessions", () => {
    const store = new SessionStore();
    const session = store.create("mock", "m1");
    expect(store.remove(session.id)).toBe(true);
    expect(store.load(session.id)).toBeUndefined();
  });

  it("clears messages", () => {
    const store = new SessionStore();
    const session = store.create("mock", "m1");
    store.addMessage(session, { role: "user", content: "hi" });
    const cleared = store.clearMessages(session);
    expect(cleared.messages).toEqual([]);
  });

  it("writes one file per session in the sessions directory", () => {
    const store = new SessionStore();
    store.create("mock", "m1");
    const files = readdirSync(`${process.env.CODER_HOME}/sessions`);
    expect(files).toEqual(["session-001.json"]);
  });
});

describe("HistoryManager", () => {
  it("creates and tracks the current session", () => {
    const store = new SessionStore();
    const history = new HistoryManager(store);
    const session = history.getOrCreateCurrent("mock", "mock/coder-1");
    expect(history.currentId()).toBe(session.id);
    expect(history.getOrCreateCurrent("mock", "mock/coder-1").id).toBe(session.id);
  });

  it("starts a new session on demand", () => {
    const store = new SessionStore();
    const history = new HistoryManager(store);
    const a = history.getOrCreateCurrent("mock", "m1");
    const b = history.newSession("mock", "m2");
    expect(b.id).not.toBe(a.id);
    expect(history.currentId()).toBe(b.id);
  });

  it("clears the current session's messages", () => {
    const store = new SessionStore();
    const history = new HistoryManager(store);
    const session = history.getOrCreateCurrent("mock", "m1");
    store.addMessage(session, { role: "user", content: "hi" });
    history.clearCurrent();
    expect(store.load(session.id)?.messages).toEqual([]);
  });

  it("removes the pointer when the current session is removed", () => {
    const store = new SessionStore();
    const history = new HistoryManager(store);
    const session = history.getOrCreateCurrent("mock", "m1");
    history.remove(session.id);
    expect(history.currentId()).toBeUndefined();
  });
});
