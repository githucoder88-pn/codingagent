/**
 * Unit tests: persistent scoped memory (Phase 5/7/9).
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScopedMemory, canonicalScope, isKnownScope } from "../../src/session/memory/scoped.js";

let home = "";
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "coder-mem-"));
  process.env.CODER_HOME = home;
});
afterEach(() => {
  delete process.env.CODER_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("scoped memory", () => {
  it("maps hierarchy aliases to canonical scopes", () => {
    expect(canonicalScope("immediate")).toBe("session");
    expect(canonicalScope("working")).toBe("project");
    expect(canonicalScope("long-term")).toBe("user");
    expect(canonicalScope("global")).toBe("global");
    expect(isKnownScope("working")).toBe(true);
    expect(isKnownScope("nonsense")).toBe(false);
    expect(canonicalScope("nonsense")).toBe("user"); // safe default
  });

  it("stores, recalls and searches across scopes", () => {
    const mem = new ScopedMemory();
    mem.store("user", "goal", "ship v7", { kind: "episodic" });
    mem.store("session", "task", "build feature", { repo: undefined });
    mem.store("project", "dec", "use react", { repo: "repo:/x" });

    expect(mem.recall("user", "goal")).toHaveLength(1);
    expect(mem.recall("user", "goal")[0]!.value).toBe("ship v7");
    expect(mem.recall("user", "goal")[0]!.kind).toBe("episodic");

    expect(mem.search("feature")).toHaveLength(1);
    expect(mem.search("react", "project")).toHaveLength(1);
    expect(mem.search("react", "user")).toHaveLength(0);

    // global total across scopes
    expect(mem.count()).toBeGreaterThanOrEqual(3);
  });

  it("removes entries by id within a scope", () => {
    const mem = new ScopedMemory();
    const entry = mem.store("user", "k", "v");
    expect(mem.remove("user", entry.id)).toBe(true);
    expect(mem.recall("user", "k")).toHaveLength(0);
    expect(mem.remove("user", entry.id)).toBe(false);
  });
});
