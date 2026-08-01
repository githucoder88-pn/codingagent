import { describe, expect, it } from "vitest";
import { Memory } from "../../src/session/memory/memory.js";
import { type ChatMessage } from "../../src/types/index.js";

function msgs(n: number): ChatMessage[] {
  const out: ChatMessage[] = [{ role: "system", content: "sys" }];
  for (let i = 0; i < n; i += 1) {
    out.push({ role: "user", content: `user-${i}` });
    out.push({ role: "assistant", content: `assistant-${i}` });
  }
  return out;
}

describe("Memory", () => {
  it("caches sessions with a cap", () => {
    const memory = new Memory();
    for (let i = 0; i < 60; i += 1) {
      memory.remember({ id: `s-${i}`, createdAt: "", updatedAt: "", provider: "mock", model: "m", messages: [] });
    }
    // Only the most recent 50 survive.
    expect(memory.recall("s-0")).toBeUndefined();
    expect(memory.recall("s-59")).toBeDefined();
    memory.forget("s-59");
    expect(memory.recall("s-59")).toBeUndefined();
  });

  it("caps messages at SESSION_MAX_MESSAGES", () => {
    const memory = new Memory();
    const trimmed = memory.trimToBudget(msgs(150)); // 301 messages
    expect(trimmed.length).toBeLessThanOrEqual(200);
    // System prompt always survives.
    expect(trimmed[0]?.role).toBe("system");
    // The tail (most recent) survives.
    expect(trimmed[trimmed.length - 1]?.content).toBe("assistant-149");
  });

  it("drops oldest turns when over a token budget", () => {
    const memory = new Memory();
    const trimmed = memory.trimToBudget(msgs(40), { budgetTokens: 20, keepRecent: 4 });
    expect(trimmed[0]?.role).toBe("system");
    expect(trimmed.length).toBeGreaterThanOrEqual(1);
    expect(trimmed.length).toBeLessThan(msgs(40).length);
    expect(trimmed[trimmed.length - 1]?.content).toBe("assistant-39");
  });

  it("returns messages unchanged when within limits", () => {
    const memory = new Memory();
    const list = msgs(2);
    expect(memory.trimToBudget(list)).toEqual(list);
  });
});
