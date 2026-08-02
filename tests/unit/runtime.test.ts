/**
 * Unit tests: runtime modes + generic JSON store.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionMode, parseMode, modeRequiresBackend, modeIsOffline, ALL_EXECUTION_MODES } from "../../src/runtime/modes.js";
import { JsonStore, shortId, nowIso } from "../../src/runtime/store.js";

let home = "";
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "coder-runtime-"));
  process.env.CODER_HOME = home;
});
afterEach(() => {
  delete process.env.CODER_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("execution modes", () => {
  it("exposes all seven modes incl. offline", () => {
    expect(ALL_EXECUTION_MODES).toContain(ExecutionMode.OFFLINE);
    expect(ALL_EXECUTION_MODES).toHaveLength(7);
  });
  it("parses known modes (case-insensitive)", () => {
    expect(parseMode("CLOUD")).toBe(ExecutionMode.CLOUD);
    expect(parseMode("organization")).toBe(ExecutionMode.ORGANIZATION);
    expect(parseMode(undefined)).toBe(ExecutionMode.LOCAL);
  });
  it("rejects unknown modes", () => {
    expect(() => parseMode("quantum")).toThrow(/Unknown execution mode/);
  });
  it("classifies backend/offline modes", () => {
    expect(modeRequiresBackend(ExecutionMode.CLOUD)).toBe(true);
    expect(modeRequiresBackend(ExecutionMode.ENTERPRISE)).toBe(true);
    expect(modeRequiresBackend(ExecutionMode.ORGANIZATION)).toBe(true);
    expect(modeRequiresBackend(ExecutionMode.LOCAL)).toBe(false);
    expect(modeIsOffline(ExecutionMode.OFFLINE)).toBe(true);
    expect(modeIsOffline(ExecutionMode.LOCAL)).toBe(false);
  });
});

describe("JsonStore", () => {
  it("returns the fallback when absent", () => {
    const store = new JsonStore(join(home, "a.json"), { n: 0, items: [] as number[] });
    expect(store.read()).toEqual({ n: 0, items: [] });
    expect(store.present()).toBe(false);
  });
  it("persists updates atomically", () => {
    const store = new JsonStore<{ items: string[] }>(join(home, "sub", "b.json"), { items: [] });
    const next = store.update((v) => v.items.push("x"));
    expect(next.items).toEqual(["x"]);
    expect(store.present()).toBe(true);
    const onDisk = JSON.parse(readFileSync(join(home, "sub", "b.json"), "utf8"));
    expect(onDisk.items).toEqual(["x"]);
  });
  it("survives a new instance (file-backed)", () => {
    const file = join(home, "c.json");
    new JsonStore<{ count: number }>(file, { count: 0 }).update((v) => (v.count = 42));
    const again = new JsonStore<{ count: number }>(file, { count: 0 }).read();
    expect(again.count).toBe(42);
  });
  it("generates stable-ish ids + iso timestamps", () => {
    expect(shortId("x-")).toMatch(/^x-/);
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(existsSync(join(home, "nope.json"))).toBe(false);
  });
});
