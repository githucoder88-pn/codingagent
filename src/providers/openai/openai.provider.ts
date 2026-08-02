/**
 * CODER — OpenAI provider.
 *
 * Chat Completions API (GPT and O-series models):
 *   POST {base}/chat/completions
 *   GET  {base}/models
 * Auth: `Authorization: Bearer <key>`.
 * Streaming: SSE `data:` chunks with `choices[0].delta.content`, `[DONE]` end.
 */

import { type ChatRequest, type ChatResponse, type Model } from "../../types/index.js";
import { FALLBACK_MODELS } from "../known-models.js";
import { BaseProvider } from "../base/provider.base.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export class OpenAiProvider extends BaseProvider {
  readonly id: string = "openai";
  readonly name: string = "OpenAI";
  readonly defaultModel: string = "gpt-4o-mini";
  readonly requiresKey: boolean = true;

  protected defaultBaseUrl(): string {
    return DEFAULT_BASE_URL;
  }

  chatEndpoint(_model: string): string {
    return `${this.baseUrl()}/chat/completions`;
  }

  modelsEndpoint(): string {
    return `${this.baseUrl()}/models`;
  }

  buildChatPayload(request: ChatRequest): unknown {
    return {
      model: request.model,
      messages: request.messages,
      stream: request.stream ?? false,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    };
  }

  parseChatResponse(json: unknown, request: ChatRequest): ChatResponse {
    const j = json as Record<string, unknown> | null;
    const usage = j?.usage as Record<string, unknown> | undefined;
    const choices = j?.choices as Array<Record<string, unknown>> | undefined;
    const message = choices?.[0]?.message as Record<string, unknown> | undefined;
    return {
      id: typeof j?.id === "string" ? j.id : `chatcmpl-${Date.now()}`,
      model: typeof j?.model === "string" ? j.model : request.model,
      content: typeof message?.content === "string" ? message.content : "",
      usage: {
        inputTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : undefined,
        outputTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : undefined,
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
    const choices = j.choices as Array<Record<string, unknown>> | undefined;
    const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
    const text = delta?.content;
    return typeof text === "string" ? text : null;
  }

  parseModels(json: unknown): Model[] {
    const data = (json as { data?: Array<{ id?: string }> })?.data ?? [];
    const ids = data
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    return this.enrichModels(ids.length ? ids : FALLBACK_MODELS.openai ?? []);
  }
}
