/**
 * CODER — session memory.
 *
 * In-process cache of recently used sessions plus a token-budget trimmer
 * that keeps request payloads within the model's context window by dropping
 * the oldest turns (the system prompt and the most recent messages always
 * survive).
 */

import { type Session, type ChatMessage } from "../../types/index.js";
import { SESSION_MAX_MESSAGES } from "../../core/constants/index.js";
import { estimateTokens } from "../../utils/format.js";

const MAX_CACHED_SESSIONS = 50;

export class Memory {
  private readonly cache = new Map<string, Session>();

  remember(session: Session): void {
    this.cache.set(session.id, session);
    if (this.cache.size > MAX_CACHED_SESSIONS) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  recall(id: string): Session | undefined {
    return this.cache.get(id);
  }

  forget(id: string): void {
    this.cache.delete(id);
  }

  /**
   * Trim a message list to fit `budgetTokens` (approximate) and never more
   * than SESSION_MAX_MESSAGES entries. The first message (typically the
   * system prompt) and the last `keepRecent` messages are always kept.
   */
  trimToBudget(
    messages: ChatMessage[],
    opts?: { budgetTokens?: number; keepRecent?: number },
  ): ChatMessage[] {
    const budget = opts?.budgetTokens ?? 0;
    const keepRecent = opts?.keepRecent ?? 20;
    if (budget <= 0 && messages.length <= SESSION_MAX_MESSAGES) return messages;

    const trimmed = [...messages];
    while (
      trimmed.length > Math.max(1, keepRecent) &&
      trimmed.length > SESSION_MAX_MESSAGES
    ) {
      // Remove the oldest non-system message.
      const idx = trimmed.findIndex((m, i) => m.role !== "system" && i < trimmed.length - keepRecent);
      if (idx === -1) break;
      trimmed.splice(idx, 1);
    }

    if (budget > 0) {
      let total = 0;
      for (const m of trimmed) total += estimateTokens(m.content);
      while (total > budget && trimmed.length > Math.max(1, keepRecent)) {
        const idx = trimmed.findIndex((m, i) => m.role !== "system" && i < trimmed.length - keepRecent);
        if (idx === -1) break;
        total -= estimateTokens(trimmed[idx]?.content ?? "");
        trimmed.splice(idx, 1);
      }
    }
    return trimmed;
  }
}
