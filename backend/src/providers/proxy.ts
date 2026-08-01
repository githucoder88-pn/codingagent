/**
 * CODER backend — server-side provider proxy.
 *
 * Implements the "use key" workflow of the security model:
 *   1. backend fetches the encrypted provider key
 *   2. backend decrypts it in memory
 *   3. the key is used for the provider request
 *   4. the decrypted key is discarded immediately (never persisted)
 *
 * Minimal wire-format clients for OpenAI-compatible APIs (OpenAI,
 * OpenRouter), Anthropic and Gemini. Non-streaming only in this phase.
 */

import { fingerprint } from "../../../shared/src/index.js";
import type { ChatRequest, ChatResponse } from "../../../src/types/index.js";

export interface ProxyKey {
  provider: string;
  apiKey: string;
  fingerprint: string;
}

export type ProxyProvider = "openai" | "anthropic" | "gemini" | "openrouter";

const BASE_URLS: Record<ProxyProvider, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};

export async function proxyChat(
  provider: ProxyProvider,
  key: string,
  request: ChatRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ChatResponse> {
  switch (provider) {
    case "openai":
    case "openrouter":
      return openAiCompatible(provider, key, request, fetchImpl);
    case "anthropic":
      return anthropicChat(key, request, fetchImpl);
    case "gemini":
      return geminiChat(key, request, fetchImpl);
  }
}

// ------------------------------------------------------------- helpers

function fail(status: number, body: unknown): never {
  let message = "unknown error";
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const error = obj.error;
    const errorMessage = error && typeof error === "object" ? (error as Record<string, unknown>).message : undefined;
    message = String(errorMessage ?? obj.message ?? message);
  } else if (typeof body === "string" && body) {
    message = body.slice(0, 300);
  }
  const err = new Error(`Provider returned HTTP ${status}: ${message}`) as Error & { status: number };
  err.status = status;
  throw err;
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  payload: unknown,
  fetchImpl: typeof fetch,
  timeoutMs = 60_000,
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`Provider request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

// ------------------------------------------------------------- adapters

async function openAiCompatible(
  provider: ProxyProvider,
  key: string,
  request: ChatRequest,
  fetchImpl: typeof fetch,
): Promise<ChatResponse> {
  const url = `${BASE_URLS[provider]}/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/coder-cli/coder";
    headers["X-Title"] = "CODER";
  }
  const { status, body } = await postJson(
    url,
    headers,
    {
      model: request.model,
      messages: request.messages,
      stream: false,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    },
    fetchImpl,
  );
  if (status >= 400) fail(status, body);
  const j = body as Record<string, unknown> | null;
  const choices = j?.choices as Array<Record<string, unknown>> | undefined;
  const message = choices?.[0]?.message as Record<string, unknown> | undefined;
  const usage = j?.usage as Record<string, unknown> | undefined;
  return {
    id: typeof j?.id === "string" ? j.id : `proxy-${Date.now()}`,
    model: typeof j?.model === "string" ? j.model : request.model,
    content: typeof message?.content === "string" ? message.content : "",
    usage: {
      inputTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : undefined,
      outputTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : undefined,
    },
    createdAt: new Date().toISOString(),
  };
}

async function anthropicChat(key: string, request: ChatRequest, fetchImpl: typeof fetch): Promise<ChatResponse> {
  const system = request.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const messages = request.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
  const { status, body } = await postJson(
    `${BASE_URLS.anthropic}/messages`,
    {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    {
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      stream: false,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(system ? { system } : {}),
      messages,
    },
    fetchImpl,
  );
  if (status >= 400) fail(status, body);
  const j = body as Record<string, unknown> | null;
  const blocks = (j?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
  const usage = j?.usage as Record<string, unknown> | undefined;
  return {
    id: typeof j?.id === "string" ? j.id : `msg-${Date.now()}`,
    model: typeof j?.model === "string" ? j.model : request.model,
    content: blocks.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join(""),
    usage: {
      inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined,
      outputTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined,
    },
    createdAt: new Date().toISOString(),
  };
}

async function geminiChat(key: string, request: ChatRequest, fetchImpl: typeof fetch): Promise<ChatResponse> {
  const system = request.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents = request.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const payload: Record<string, unknown> = { contents };
  if (system) payload.systemInstruction = { parts: [{ text: system }] };
  const generationConfig: Record<string, unknown> = {};
  if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
  if (request.maxTokens !== undefined) generationConfig.maxOutputTokens = request.maxTokens;
  if (Object.keys(generationConfig).length) payload.generationConfig = generationConfig;

  const model = request.model.startsWith("models/") ? request.model.slice(7) : request.model;
  const { status, body } = await postJson(
    `${BASE_URLS.gemini}/models/${model}:generateContent`,
    { "Content-Type": "application/json", "x-goog-api-key": key },
    payload,
    fetchImpl,
  );
  if (status >= 400) fail(status, body);
  const j = body as Record<string, unknown> | null;
  const candidates = (j?.candidates as Array<Record<string, unknown>> | undefined) ?? [];
  const content = candidates[0]?.content as Record<string, unknown> | undefined;
  const parts = (content?.parts as Array<{ text?: string }> | undefined) ?? [];
  const usage = j?.usageMetadata as Record<string, unknown> | undefined;
  return {
    id: typeof j?.responseId === "string" ? j.responseId : `gemini-${Date.now()}`,
    model: request.model,
    content: parts.filter((p) => typeof p.text === "string").map((p) => p.text).join(""),
    usage: {
      inputTokens: typeof usage?.promptTokenCount === "number" ? usage.promptTokenCount : undefined,
      outputTokens: typeof usage?.candidatesTokenCount === "number" ? usage.candidatesTokenCount : undefined,
    },
    createdAt: new Date().toISOString(),
  };
}

/** Fingerprint helper re-exported for key-validation flows. */
export function keyFingerprint(key: string): string {
  return fingerprint(key);
}
