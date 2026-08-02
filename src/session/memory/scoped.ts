/**
 * CODER — persistent scoped memory (Phase 5 / 7 / 9).
 *
 * `coder memory store|recall|search --scope <name>` backs onto this store.
 * Canonical scopes are `session`, `project`, `user`, `global`. The memory
 * hierarchy aliases map onto them:
 *
 *   immediate  → session
 *   working    → project   (keyed `repo:<abs path>`)
 *   long-term  → user
 *   global     → global
 *
 * Episodic / semantic / procedural are knowledge *kinds* recorded against
 * the long-term (user) and global stores. All entries are persisted as JSON
 * under ~/.coder/memory/.
 */

import { join } from "node:path";
import { readJson, writeJson } from "../../utils/paths.js";
import { nowIso, shortId } from "../../runtime/store.js";

export type MemoryScope = "session" | "project" | "user" | "global";

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  key: string;
  value: string;
  kind?: "episodic" | "semantic" | "procedural" | "fact";
  repo?: string;
  createdAt: string;
}

export interface MemoryStoreData {
  entries: MemoryEntry[];
}

/** Map any accepted --scope alias to a canonical scope. */
export function canonicalScope(input: string): MemoryScope {
  switch (input.toLowerCase()) {
    case "session":
    case "immediate":
      return "session";
    case "project":
    case "working":
      return "project";
    case "user":
    case "long-term":
    case "longterm":
      return "user";
    case "global":
      return "global";
    default:
      return "user";
  }
}

export function isKnownScope(input: string): boolean {
  return ["session", "project", "user", "global", "immediate", "working", "long-term", "longterm"].includes(input.toLowerCase());
}

const FILE = (scope: MemoryScope) => join(coderHome(), "memory", `${scope}.json`);
function coderHome(): string {
  return process.env.CODER_HOME ?? join(homedir(), ".coder");
}
import { homedir } from "node:os";

export class ScopedMemory {
  read(scope: MemoryScope): MemoryStoreData {
    return readJson<MemoryStoreData>(FILE(scope)) ?? { entries: [] };
  }

  private write(scope: MemoryScope, data: MemoryStoreData): void {
    writeJson(FILE(scope), data);
  }

  store(scope: MemoryScope, key: string, value: string, opts?: { kind?: MemoryEntry["kind"]; repo?: string }): MemoryEntry {
    const data = this.read(scope);
    const entry: MemoryEntry = {
      id: shortId("mem-"),
      scope,
      key,
      value,
      kind: opts?.kind ?? "fact",
      repo: opts?.repo,
      createdAt: nowIso(),
    };
    data.entries.unshift(entry);
    data.entries = data.entries.slice(0, 500);
    this.write(scope, data);
    return entry;
  }

  recall(scope: MemoryScope, key: string): MemoryEntry[] {
    return this.read(scope).entries.filter((e) => e.key.toLowerCase().includes(key.toLowerCase()));
  }

  search(query: string, scope?: MemoryScope): MemoryEntry[] {
    const scopes: MemoryScope[] = scope ? [scope] : ["session", "project", "user", "global"];
    const q = query.toLowerCase();
    const results: MemoryEntry[] = [];
    for (const s of scopes) {
      for (const e of this.read(s).entries) {
        if (e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q)) results.push(e);
      }
    }
    return results;
  }

  remove(scope: MemoryScope, id: string): boolean {
    const data = this.read(scope);
    const before = data.entries.length;
    data.entries = data.entries.filter((e) => e.id !== id);
    this.write(scope, data);
    return data.entries.length < before;
  }

  count(scope?: MemoryScope): number {
    return this.search("", scope).length || (scope ? this.read(scope).entries.length : 0);
  }
}
