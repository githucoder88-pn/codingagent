/**
 * CODER — session storage.
 *
 * Conversations are stored as human-readable JSON files, one per session:
 *   ~/.coder/sessions/session-001.json
 * The store validates files on load so a hand-edited or corrupted session
 * never crashes the CLI.
 */

import { z } from "zod";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type Session, type ChatMessage } from "../../types/index.js";
import { SessionError } from "../../core/errors/index.js";
import { paths, readJson, writeJson } from "../../utils/paths.js";

export const sessionSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  provider: z.string().min(1),
  model: z.string().min(1),
  messages: z.array(
    z.object({
      role: z.enum(["system", "user", "assistant", "tool"]),
      content: z.string(),
    }),
  ),
});

export interface SessionMeta {
  id: string;
  createdAt: string;
  updatedAt: string;
  provider: string;
  model: string;
  messageCount: number;
}

export class SessionStore {
  /** Create a new session with the next free `session-NNN` id. */
  create(provider: string, model: string): Session {
    const now = new Date().toISOString();
    const session: Session = {
      id: this.nextId(),
      createdAt: now,
      updatedAt: now,
      provider,
      model,
      messages: [],
    };
    this.save(session);
    return session;
  }

  nextId(): string {
    let max = 0;
    for (const file of this.listFiles()) {
      const match = /^session-(\d+)\.json$/.exec(file);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return `session-${String(max + 1).padStart(3, "0")}`;
  }

  private listFiles(): string[] {
    try {
      return readdirSync(paths.sessionsDir()).filter((f) => /^session-\d+\.json$/.test(f));
    } catch {
      return [];
    }
  }

  private fileFor(id: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new SessionError(`Invalid session id "${id}"`);
    }
    return join(paths.sessionsDir(), `${id}.json`);
  }

  save(session: Session): void {
    const parsed = sessionSchema.safeParse(session);
    if (!parsed.success) {
      throw new SessionError(`Refusing to save invalid session: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    }
    const updated = { ...session, updatedAt: new Date().toISOString() };
    writeJson(this.fileFor(session.id), updated);
  }

  load(id: string): Session | undefined {
    let raw: unknown;
    try {
      raw = readJson<unknown>(this.fileFor(id));
    } catch (err) {
      throw new SessionError(`Session "${id}" is corrupt: ${(err as Error).message}`);
    }
    if (raw === undefined) return undefined;
    const parsed = sessionSchema.safeParse(raw);
    if (!parsed.success) {
      throw new SessionError(`Session "${id}" is corrupt: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    }
    return parsed.data;
  }

  exists(id: string): boolean {
    return this.load(id) !== undefined;
  }

  list(): SessionMeta[] {
    return this.listFiles()
      .map((file) => {
        const id = file.replace(/\.json$/, "");
        const session = this.load(id);
        if (!session) return undefined;
        return {
          id: session.id,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          provider: session.provider,
          model: session.model,
          messageCount: session.messages.length,
        } satisfies SessionMeta;
      })
      .filter((s): s is SessionMeta => s !== undefined)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  remove(id: string): boolean {
    const file = this.fileFor(id);
    try {
      rmSync(file, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  addMessage(session: Session, message: ChatMessage): Session {
    const next: Session = {
      ...session,
      messages: [...session.messages, message],
    };
    this.save(next);
    return next;
  }

  clearMessages(session: Session): Session {
    const next: Session = { ...session, messages: [] };
    this.save(next);
    return next;
  }
}
