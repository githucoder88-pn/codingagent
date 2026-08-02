/**
 * CODER — generic persisted JSON store (Phase 4+).
 *
 * Thin wrapper over the atomic readJson/writeJson helpers in utils/paths.
 * Every new phase-level store (tasks, mcp servers, extensions, skills,
 * orgs, outbox, knowledge graph, …) is a JSON document under ~/.coder;
 * this keeps the access pattern uniform and testable.
 */

import { readJson, writeJson, exists } from "../utils/paths.js";

export class JsonStore<T> {
  constructor(private readonly file: string, private readonly fallback: T) {}

  read(): T {
    return readJson<T>(this.file) ?? structuredClone(this.fallback);
  }

  write(value: T): void {
    writeJson(this.file, value);
  }

  /** Read, mutate, write atomically. */
  update(mutate: (value: T) => void): T {
    const value = this.read();
    mutate(value);
    this.write(value);
    return value;
  }

  present(): boolean {
    return exists(this.file);
  }
}

/** ISO timestamp helper for stores. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Short stable id (8 hex chars from a counter + randomness). */
export function shortId(prefix = ""): string {
  const rand = Math.random().toString(16).slice(2, 8);
  const time = Date.now().toString(16).slice(-4);
  return `${prefix}${time}${rand}`;
}
