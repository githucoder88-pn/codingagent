/**
 * CODER — session history manager.
 *
 * Tracks the "current" session across CLI invocations so that repeated
 * `coder ask` calls continue the same conversation (and `coder chat`
 * resumes it). The pointer lives in ~/.coder/sessions/current.json.
 */

import { type Session } from "../../types/index.js";
import { SessionStore } from "../storage/session-store.js";
import { paths, readJson, writeJson } from "../../utils/paths.js";
import { rmSync } from "node:fs";

export class HistoryManager {
  constructor(private readonly store: SessionStore) {}

  /** Id of the current session (undefined when none was ever created). */
  currentId(): string | undefined {
    const raw = readJson<{ sessionId?: string }>(paths.currentSession());
    if (!raw || typeof raw.sessionId !== "string") return undefined;
    return raw.sessionId;
  }

  setCurrent(id: string): void {
    writeJson(paths.currentSession(), { sessionId: id });
  }

  /**
   * Load the current session, creating one bound to `provider`/`model` when
   * none exists yet.
   */
  getOrCreateCurrent(provider: string, model: string): Session {
    const id = this.currentId();
    if (id) {
      const existing = this.store.load(id);
      if (existing) return existing;
    }
    const session = this.store.create(provider, model);
    this.setCurrent(session.id);
    return session;
  }

  /** Start a fresh session (used by `coder chat` after `/new`). */
  newSession(provider: string, model: string): Session {
    const session = this.store.create(provider, model);
    this.setCurrent(session.id);
    return session;
  }

  /** Load the current session without creating one. */
  loadCurrent(): Session | undefined {
    const id = this.currentId();
    if (!id) return undefined;
    return this.store.load(id);
  }

  clearCurrent(): void {
    const id = this.currentId();
    if (!id) return;
    const session = this.store.load(id);
    if (session) this.store.clearMessages(session);
  }

  remove(id: string): boolean {
    const removed = this.store.remove(id);
    if (removed && this.currentId() === id) {
      try {
        rmSync(paths.currentSession(), { force: true });
      } catch {
        /* best effort */
      }
    }
    return removed;
  }
}
