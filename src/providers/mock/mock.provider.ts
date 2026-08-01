/**
 * CODER — mock provider.
 *
 * A fully offline provider used by smoke tests, e2e tests and demos without
 * API keys or network access. It echoes the user's message with a small
 * canned completion so every command can be exercised end to end.
 */

import { type ChatRequest, type ChatResponse, type Model } from "../../types/index.js";
import { type Provider } from "../base/provider.interface.js";

const MODELS: Model[] = [
  { id: "mock/coder-1", provider: "mock", contextWindow: 8192, supportsTools: true, name: "Coder Mock 1" },
  { id: "mock/coder-2", provider: "mock", contextWindow: 16_384, supportsTools: true, name: "Coder Mock 2" },
  { id: "mock/echo", provider: "mock", contextWindow: 4096, supportsTools: false, name: "Echo" },
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockProvider implements Provider {
  readonly id = "mock";
  readonly name = "Mock (offline)";
  readonly defaultModel = "mock/coder-1";
  readonly requiresKey = false;

  async initialize(): Promise<void> {}

  async authenticate(_apiKey: string): Promise<boolean> {
    return true;
  }

  async listModels(): Promise<Model[]> {
    return MODELS;
  }

  private reply(request: ChatRequest): string {
    const lastUser = [...request.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    return [
      `[mock:${request.model}] This is a simulated completion.`,
      "",
      `You said: "${lastUser}"`,
      "",
      "Run `coder auth <provider>` with a real provider (openai, anthropic, gemini, openrouter) to chat with actual models.",
    ].join("\n");
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    await delay(10);
    return {
      id: `mock-${Date.now()}`,
      model: request.model,
      content: this.reply(request),
      usage: { inputTokens: 1, outputTokens: 1 },
      createdAt: new Date().toISOString(),
    };
  }

  async *stream(request: ChatRequest): AsyncGenerator<string> {
    const words = this.reply(request).split(" ");
    for (let i = 0; i < words.length; i += 3) {
      yield words.slice(i, i + 3).join(" ") + (i + 3 < words.length ? " " : "");
      await delay(1);
    }
  }
}
