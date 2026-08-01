/**
 * CODER — Anthropic provider.
 *
 * Messages API (Claude models):
 *   POST {base}/messages
 *   GET  {base}/models
 * Auth: `x-api-key: <key>` + `anthropic-version: 2023-06-01`.
 * Streaming: SSE events; text arrives in `content_block_delta` →
 * `delta.type === "text_delta"` → `delta.text`.
 */

import { type ChatRequest, type ChatResponse, type Model } from "../../types/index.js";
import { FALLBACK_MODELS } from "../known-models.js";
import { BaseProvider } from "../base/provider.base.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const API_VERSION = "2023-06-01";

interface AnthropicContentBlock {
  type?: string;
  text?: string;
}

export class AnthropicProvider extends BaseProvider {
  readonly id = "anthropic";
  readonly name = "Anthropic";
  readonly defaultModel = "claude-sonnet-4";
  readonly requiresKey = true;

  protected defaultBaseUrl(): string {
    return DEFAULT_BASE_URL;
  }

  chatEndpoint(_model: string): string {
    return `${this.baseUrl()}/messages`;
  }

  modelsEndpoint(): string {
    return `${this.baseUrl()}/models`;
  }

  protected override authHeaders(apiKey: string): Record<string, string> {
    return {
      "x-api-key": apiKey,
      "anthropic-version": API_VERSION,
    };
  }

  buildChatPayload(request: ChatRequest): unknown {
    const system = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));
    return {
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      stream: request.stream ?? false,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(system ? { system } : {}),
      messages,
    };
  }

  parseChatResponse(json: unknown, request: ChatRequest): ChatResponse {
    const j = json as Record<string, unknown> | null;
    const blocks = (j?.content as AnthropicContentBlock[] | undefined) ?? [];
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

  parseStreamData(data: string): string | null {
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (j.type !== "content_block_delta") return null;
    const delta = j.delta as Record<string, unknown> | undefined;
    if (delta?.type !== "text_delta") return null;
    return typeof delta.text === "string" ? delta.text : null;
  }

  parseModels(json: unknown): Model[] {
    const data = (json as { data?: Array<{ id?: string; display_name?: string }> })?.data ?? [];
    const ids = data
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const list = ids.length ? ids : FALLBACK_MODELS.anthropic ?? [];
    const byId = new Map(data.map((m) => [m.id, m.display_name]));
    return this.enrichModels(list).map((m) => ({
      ...m,
      name: byId.get(m.id) ?? m.name,
    }));
  }
}
