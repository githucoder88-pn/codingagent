/**
 * Unit tests for the provider wire-format translations (payload builders,
 * response parsers, SSE delta parsers) — no network involved.
 */

import { describe, expect, it } from "vitest";
import { ConfigManager } from "../../src/config/manager/config-manager.js";
import { HttpClient } from "../../src/providers/http-client.js";
import { OpenAiProvider } from "../../src/providers/openai/openai.provider.js";
import { OpenRouterProvider } from "../../src/providers/openrouter/openrouter.provider.js";
import { AnthropicProvider } from "../../src/providers/anthropic/anthropic.provider.js";
import { GeminiProvider } from "../../src/providers/gemini/gemini.provider.js";
import { MockProvider } from "../../src/providers/mock/mock.provider.js";
import { useTempHome } from "../helpers/temp-home.js";
import { type ChatRequest } from "../../src/types/index.js";

useTempHome();

function request(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: "test-model",
    messages: [
      { role: "system", content: "be brief" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "again" },
    ],
    stream: false,
    ...overrides,
  };
}

describe("OpenAI wire format", () => {
  const config = new ConfigManager();
  const p = new OpenAiProvider(config, new HttpClient());

  it("builds a chat/completions payload", () => {
    const payload = p.buildChatPayload(request()) as Record<string, unknown>;
    expect(payload.model).toBe("test-model");
    expect(payload.messages).toHaveLength(4);
    expect(payload.stream).toBe(false);
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("max_tokens");
  });

  it("passes temperature and max tokens through", () => {
    const payload = p.buildChatPayload(request({ temperature: 0.5, maxTokens: 100 })) as Record<string, unknown>;
    expect(payload.temperature).toBe(0.5);
    expect(payload.max_tokens).toBe(100);
  });

  it("parses chat responses", () => {
    const res = p.parseChatResponse(
      {
        id: "chatcmpl-1",
        model: "gpt-4o",
        choices: [{ message: { content: "the answer" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      },
      request(),
    );
    expect(res.content).toBe("the answer");
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(res.model).toBe("gpt-4o");
  });

  it("parses streaming deltas and ignores non-content chunks", () => {
    expect(p.parseStreamData('{"choices":[{"delta":{"content":"hi"}}]}')).toBe("hi");
    expect(p.parseStreamData('{"choices":[{"delta":{"role":"assistant"}}]}')).toBeNull();
    expect(p.parseStreamData("not json")).toBeNull();
  });

  it("parses the model catalogue with context enrichment", () => {
    const models = p.parseModels({
      data: [{ id: "gpt-4o" }, { id: "gpt-5" }, { id: "weird-model" }],
    });
    expect(models).toHaveLength(3);
    const gpt5 = models.find((m) => m.id === "gpt-5");
    expect(gpt5?.contextWindow).toBe(400_000);
    expect(gpt5?.supportsTools).toBe(true);
    const weird = models.find((m) => m.id === "weird-model");
    expect(weird?.contextWindow).toBe(0);
  });
});

describe("Anthropic wire format", () => {
  const p = new AnthropicProvider(new ConfigManager(), new HttpClient());

  it("extracts system prompt and maps roles", () => {
    const payload = p.buildChatPayload(request()) as Record<string, unknown>;
    expect(payload.system).toBe("be brief");
    const messages = payload.messages as Array<{ role: string }>;
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: "user", content: "hello" });
    expect(messages[1]).toEqual({ role: "assistant", content: "hi" });
  });

  it("defaults max_tokens when not provided", () => {
    const payload = p.buildChatPayload(request()) as Record<string, unknown>;
    expect(payload.max_tokens).toBe(4096);
  });

  it("uses x-api-key and anthropic-version headers", () => {
    const headers = (p as unknown as { authHeaders(k: string): Record<string, string> }).authHeaders("sk-ant-1");
    expect(headers["x-api-key"]).toBe("sk-ant-1");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("parses text blocks from responses", () => {
    const res = p.parseChatResponse(
      {
        id: "msg_1",
        model: "claude-sonnet-4",
        content: [{ type: "text", text: "one" }, { type: "text", text: "two" }, { type: "tool_use", id: "x" }],
        usage: { input_tokens: 3, output_tokens: 2 },
      },
      request(),
    );
    expect(res.content).toBe("onetwo");
    expect(res.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
  });

  it("parses content_block_delta stream events", () => {
    const delta = p.parseStreamData('{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}');
    expect(delta).toBe("Hi");
    expect(p.parseStreamData('{"type":"message_start","message":{}}')).toBeNull();
    expect(p.parseStreamData('{"type":"content_block_delta","delta":{"type":"input_json_delta"}}')).toBeNull();
  });

  it("parses the model catalogue", () => {
    const models = p.parseModels({ data: [{ id: "claude-sonnet-4", display_name: "Claude Sonnet 4" }] });
    expect(models[0]).toMatchObject({ id: "claude-sonnet-4", provider: "anthropic", contextWindow: 200_000, name: "Claude Sonnet 4" });
  });
});

describe("Gemini wire format", () => {
  const p = new GeminiProvider(new ConfigManager(), new HttpClient());

  it("maps roles and system instructions", () => {
    const payload = p.buildChatPayload(request()) as Record<string, unknown>;
    expect(payload.systemInstruction).toEqual({ parts: [{ text: "be brief" }] });
    const contents = payload.contents as Array<{ role: string }>;
    expect(contents[0]).toEqual({ role: "user", parts: [{ text: "hello" }] });
    expect(contents[1]).toEqual({ role: "model", parts: [{ text: "hi" }] });
  });

  it("builds generateContent and streamGenerateContent endpoints", () => {
    const withProtected = p as unknown as {
      chatEndpoint(m: string): string;
      streamEndpoint(m: string): string;
    };
    expect(withProtected.chatEndpoint("gemini-2.5-flash")).toContain("/models/gemini-2.5-flash:generateContent");
    expect(withProtected.streamEndpoint("models/gemini-2.5-pro")).toContain("/models/gemini-2.5-pro:streamGenerateContent?alt=sse");
  });

  it("parses candidates and usage metadata", () => {
    const res = p.parseChatResponse(
      {
        responseId: "r1",
        candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }],
        usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2 },
      },
      request(),
    );
    expect(res.content).toBe("ab");
    expect(res.usage).toEqual({ inputTokens: 7, outputTokens: 2 });
  });

  it("parses streaming candidates", () => {
    expect(p.parseStreamData('{"candidates":[{"content":{"parts":[{"text":"x"}]}}]}')).toBe("x");
    expect(p.parseStreamData('{"candidates":[]}')).toBeNull();
  });

  it("filters the model catalogue to generateContent models", () => {
    const models = p.parseModels({
      models: [
        { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent", "functionCall"], inputTokenLimit: 1_000_000 },
        { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"], inputTokenLimit: 100 },
      ],
    });
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ id: "gemini-2.5-flash", contextWindow: 1_000_000, supportsTools: true });
  });
});

describe("OpenRouter wire format", () => {
  const p = new OpenRouterProvider(new ConfigManager(), new HttpClient());

  it("identifies as openrouter with an OpenAI-compatible payload", () => {
    expect(p.id).toBe("openrouter");
    expect(p.defaultModel).toBe("openrouter/auto");
    const payload = p.buildChatPayload(request()) as Record<string, unknown>;
    expect(payload.model).toBe("test-model");
  });

  it("parses vendor models with context and tool flags", () => {
    const models = p.parseModels({
      data: [
        { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", context_length: 200_000, architecture: { tool_use: true } },
        { id: "openai/gpt-4o", name: "GPT-4o", context_length: 128_000 },
      ],
    });
    expect(models[0]).toMatchObject({ provider: "openrouter", contextWindow: 200_000, supportsTools: true, name: "Claude Sonnet 4" });
    expect(models[1]?.supportsTools).toBe(false);
  });
});

describe("Mock provider", () => {
  const p = new MockProvider();

  it("lists fixed models without a key", async () => {
    const models = await p.listModels();
    expect(models.length).toBeGreaterThanOrEqual(3);
    expect(p.requiresKey).toBe(false);
  });

  it("answers chat and streams in chunks", async () => {
    const res = await p.chat({ model: "mock/coder-1", messages: [{ role: "user", content: "ping" }] });
    expect(res.content).toContain("ping");
    let streamed = "";
    for await (const chunk of p.stream({ model: "mock/coder-1", messages: [{ role: "user", content: "ping" }] })) {
      streamed += chunk;
    }
    expect(streamed).toBe(res.content);
  });

  it("authenticates everything", async () => {
    expect(await p.authenticate("anything")).toBe(true);
  });
});
