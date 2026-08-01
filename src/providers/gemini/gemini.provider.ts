/**
 * CODER — Gemini provider.
 *
 * Generative Language API:
 *   POST {base}/models/{model}:generateContent
 *   POST {base}/models/{model}:streamGenerateContent?alt=sse
 *   GET  {base}/models
 * Auth: `x-goog-api-key: <key>`.
 * Content is exchanged as `contents[]` with `parts[].text`; roles are
 * "user"/"model" (assistant → model, system → systemInstruction).
 */

import { type ChatRequest, type ChatResponse, type Model } from "../../types/index.js";
import { FALLBACK_MODELS } from "../known-models.js";
import { BaseProvider } from "../base/provider.base.js";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiPart {
  text?: string;
}

export class GeminiProvider extends BaseProvider {
  readonly id = "gemini";
  readonly name = "Gemini";
  readonly defaultModel = "gemini-2.5-flash";
  readonly requiresKey = true;

  protected defaultBaseUrl(): string {
    return DEFAULT_BASE_URL;
  }

  chatEndpoint(model: string): string {
    return `${this.baseUrl()}/models/${this.modelPath(model)}:generateContent`;
  }

  protected override streamEndpoint(model: string): string {
    return `${this.baseUrl()}/models/${this.modelPath(model)}:streamGenerateContent?alt=sse`;
  }

  /** Model ids may be "models/gemini-2.5-flash" or "gemini-2.5-flash". */
  private modelPath(model: string): string {
    return model.startsWith("models/") ? model.slice(7) : model;
  }

  modelsEndpoint(): string {
    return `${this.baseUrl()}/models`;
  }

  protected override authHeaders(apiKey: string): Record<string, string> {
    return { "x-goog-api-key": apiKey };
  }

  buildChatPayload(request: ChatRequest): unknown {
    const system = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const contents = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    const payload: Record<string, unknown> = {
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    };
    const generationConfig: Record<string, unknown> = {};
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    if (request.maxTokens !== undefined) generationConfig.maxOutputTokens = request.maxTokens;
    if (Object.keys(generationConfig).length) payload.generationConfig = generationConfig;
    return payload;
  }

  parseChatResponse(json: unknown, request: ChatRequest): ChatResponse {
    const j = json as Record<string, unknown> | null;
    const candidates = (j?.candidates as Array<Record<string, unknown>> | undefined) ?? [];
    const content = candidates[0]?.content as Record<string, unknown> | undefined;
    const parts = (content?.parts as GeminiPart[] | undefined) ?? [];
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

  parseStreamData(data: string): string | null {
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return null;
    }
    const candidates = (j.candidates as Array<Record<string, unknown>> | undefined) ?? [];
    const content = candidates[0]?.content as Record<string, unknown> | undefined;
    const parts = (content?.parts as GeminiPart[] | undefined) ?? [];
    const text = parts.filter((p) => typeof p.text === "string").map((p) => p.text).join("");
    return text || null;
  }

  parseModels(json: unknown): Model[] {
    const models = (json as { models?: Array<Record<string, unknown>> })?.models ?? [];
    const out: Model[] = [];
    for (const m of models) {
      const methods = (m.supportedGenerationMethods as string[] | undefined) ?? [];
      if (!methods.includes("generateContent")) continue;
      const rawId = m.name;
      if (typeof rawId !== "string") continue;
      const id = rawId.startsWith("models/") ? rawId.slice(7) : rawId;
      out.push({
        id,
        provider: this.id,
        contextWindow: typeof m.inputTokenLimit === "number" ? m.inputTokenLimit : 0,
        supportsTools: methods.includes("functionCall"),
        name: id,
      });
    }
    if (out.length) return out;
    return this.enrichModels(FALLBACK_MODELS.gemini ?? []);
  }
}
