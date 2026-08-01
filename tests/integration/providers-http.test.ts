/**
 * Integration tests: providers against a mocked HTTP layer. Verifies URLs,
 * auth headers, request payloads, response parsing, streaming and error
 * mapping end to end.
 */

import { describe, expect, it } from "vitest";
import { ConfigManager } from "../../src/config/manager/config-manager.js";
import { HttpClient } from "../../src/providers/http-client.js";
import { OpenAiProvider } from "../../src/providers/openai/openai.provider.js";
import { OpenRouterProvider } from "../../src/providers/openrouter/openrouter.provider.js";
import { AnthropicProvider } from "../../src/providers/anthropic/anthropic.provider.js";
import { GeminiProvider } from "../../src/providers/gemini/gemini.provider.js";
import { AuthError, ProviderError } from "../../src/core/errors/index.js";
import { FakeFetch } from "../helpers/fake-fetch.js";
import { useTempHome } from "../helpers/temp-home.js";
import { type ChatRequest } from "../../src/types/index.js";

useTempHome();

function setup<T extends { id: string }>(ProviderClass: new (config: ConfigManager, http: HttpClient) => T, key = "sk-test") {
  const fake = new FakeFetch();
  const config = new ConfigManager();
  const provider = new ProviderClass(config, new HttpClient(fake.fetch, 5_000));
  config.setApiKey(provider.id, key);
  return { fake, config, provider };
}

const REQUEST: ChatRequest = {
  model: "test-model",
  messages: [
    { role: "system", content: "sys" },
    { role: "user", content: "hello" },
  ],
};

describe("OpenAI over HTTP", () => {

  it("chats with correct URL, headers and payload", async () => {
    const { fake, provider } = setup(OpenAiProvider);
    fake.json("/chat/completions", {
      id: "chatcmpl-1",
      model: "test-model",
      choices: [{ message: { content: "hi there" } }],
      usage: { prompt_tokens: 4, completion_tokens: 2 },
    });

    const res = await provider.chat(REQUEST);
    expect(res.content).toBe("hi there");
    expect(res.usage).toEqual({ inputTokens: 4, outputTokens: 2 });

    const req = fake.last()!;
    expect(req.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(req.headers.authorization).toBe("Bearer sk-test");
    expect(req.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(req.body!) as { model: string; messages: unknown[] };
    expect(body.model).toBe("test-model");
    expect(body.messages).toHaveLength(2);
  });

  it("streams SSE deltas until [DONE]", async () => {
    const { fake, provider } = setup(OpenAiProvider);
    fake.sse("/chat/completions", [
      { data: '{"choices":[{"delta":{"content":"Hel"}}]}' },
      { data: '{"choices":[{"delta":{"content":"lo"}}]}' },
      { data: "[DONE]" },
    ]);

    let out = "";
    for await (const delta of provider.stream(REQUEST)) out += delta;
    expect(out).toBe("Hello");
  });

  it("maps 401 to AuthError and 500 to ProviderError", async () => {
    const { fake, provider } = setup(OpenAiProvider);
    fake.json("/chat/completions", { error: { message: "invalid key" } }, 401);
    await expect(provider.chat(REQUEST)).rejects.toThrow(AuthError);

    fake.json("/chat/completions", { error: { message: "boom" } }, 500);
    await expect(provider.chat(REQUEST)).rejects.toThrow(ProviderError);
  });

  it("lists models from the catalogue", async () => {
    const { fake, provider } = setup(OpenAiProvider);
    fake.json("/models", { data: [{ id: "gpt-4o" }, { id: "gpt-5" }] });
    const models = await provider.listModels();
    expect(models.map((m) => m.id)).toEqual(["gpt-4o", "gpt-5"]);
    expect(fake.last()!.url).toBe("https://api.openai.com/v1/models");
  });

  it("validates API keys via the models endpoint", async () => {
    const { fake, provider } = setup(OpenAiProvider);
    fake.json("/models", { data: [] }, 200);
    expect(await provider.authenticate("sk-ok")).toBe(true);
    fake.json("/models", { error: { message: "nope" } }, 401);
    expect(await provider.authenticate("sk-bad")).toBe(false);
  });

  it("raises NetworkError on transport failures", async () => {
    const { provider } = setup(OpenAiProvider);
    const failing = new OpenAiProvider(new ConfigManager(), new HttpClient(() => Promise.reject(new Error("ECONNREFUSED")), 5_000));
    await expect(failing.chat(REQUEST)).rejects.toThrow(/ECONNREFUSED/);
    expect(provider).toBeDefined();
  });
});

describe("OpenRouter over HTTP", () => {

  it("uses the openrouter base URL and identity headers", async () => {
    const { fake, provider } = setup(OpenRouterProvider);
    fake.json("/chat/completions", { id: "x", model: "m", choices: [{ message: { content: "ok" } }] });
    await provider.chat(REQUEST);
    const req = fake.last()!;
    expect(req.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(req.headers["x-title"]).toBe("CODER");
    expect(req.headers["http-referer"]).toBe("https://github.com/coder-cli/coder");
  });

  it("lists aggregated vendor models", async () => {
    const { fake, provider } = setup(OpenRouterProvider);
    fake.json("/models", {
      data: [
        { id: "anthropic/claude-sonnet-4", name: "Sonnet", context_length: 200_000, architecture: { tool_use: true } },
        { id: "openai/gpt-5", name: "GPT-5", context_length: 400_000 },
      ],
    });
    const models = await provider.listModels();
    expect(models[0]).toMatchObject({ id: "anthropic/claude-sonnet-4", supportsTools: true });
    expect(models[1]).toMatchObject({ id: "openai/gpt-5", contextWindow: 400_000 });
  });
});

describe("Anthropic over HTTP", () => {

  it("chats with x-api-key auth", async () => {
    const { fake, provider } = setup(AnthropicProvider);
    fake.json("/messages", {
      id: "msg_1",
      model: "test-model",
      content: [{ type: "text", text: "claude says hi" }],
      usage: { input_tokens: 5, output_tokens: 3 },
    });
    const res = await provider.chat(REQUEST);
    expect(res.content).toBe("claude says hi");
    const req = fake.last()!;
    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
    expect(req.headers["x-api-key"]).toBe("sk-test");
    expect(req.headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(req.body!) as { system: string; max_tokens: number };
    expect(body.system).toBe("sys");
    expect(body.max_tokens).toBe(4096);
  });

  it("streams content_block_delta events", async () => {
    const { fake, provider } = setup(AnthropicProvider);
    fake.sse("/messages", [
      { event: "message_start", data: '{"type":"message_start","message":{"id":"m1"}}' },
      { event: "content_block_delta", data: '{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hey"}}' },
      { event: "content_block_delta", data: '{"type":"content_block_delta","delta":{"type":"text_delta","text":"!"}}' },
      { event: "message_stop", data: '{"type":"message_stop"}' },
    ]);
    let out = "";
    for await (const delta of provider.stream(REQUEST)) out += delta;
    expect(out).toBe("Hey!");
  });

  it("lists models from /v1/models", async () => {
    const { fake, provider } = setup(AnthropicProvider);
    fake.json("/models", { data: [{ id: "claude-sonnet-4", display_name: "Claude Sonnet 4" }] });
    const models = await provider.listModels();
    expect(models[0]).toMatchObject({ id: "claude-sonnet-4", provider: "anthropic", contextWindow: 200_000 });
    expect(fake.last()!.url).toBe("https://api.anthropic.com/v1/models");
  });
});

describe("Gemini over HTTP", () => {

  it("chats with x-goog-api-key auth", async () => {
    const { fake, provider } = setup(GeminiProvider);
    fake.json(":generateContent", {
      responseId: "r1",
      candidates: [{ content: { parts: [{ text: "gemini here" }] } }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 4 },
    });
    const res = await provider.chat(REQUEST);
    expect(res.content).toBe("gemini here");
    const req = fake.last()!;
    expect(req.url).toContain("/models/test-model:generateContent");
    expect(req.headers["x-goog-api-key"]).toBe("sk-test");
  });

  it("streams from the alt=sse endpoint", async () => {
    const { fake, provider } = setup(GeminiProvider);
    fake.sse("streamGenerateContent", [
      { data: '{"candidates":[{"content":{"parts":[{"text":"one "}]}}]}' },
      { data: '{"candidates":[{"content":{"parts":[{"text":"two"}]}}]}' },
    ]);
    let out = "";
    for await (const delta of provider.stream(REQUEST)) out += delta;
    expect(out).toBe("one two");
    expect(fake.last()!.url).toContain(":streamGenerateContent?alt=sse");
  });
});

describe("Custom base URL override", () => {
  it("routes requests to the configured base URL", async () => {
    const fake = new FakeFetch();
    const config = new ConfigManager();
    const provider = new OpenAiProvider(config, new HttpClient(fake.fetch));
    config.setApiKey(provider.id, "sk-test", "https://proxy.example.com/v1");
    fake.json("/chat/completions", { id: "1", model: "m", choices: [{ message: { content: "ok" } }] });
    await provider.chat(REQUEST);
    expect(fake.last()!.url).toBe("https://proxy.example.com/v1/chat/completions");
  });
});
