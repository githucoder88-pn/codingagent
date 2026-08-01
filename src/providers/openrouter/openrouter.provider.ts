/**
 * CODER — OpenRouter provider.
 *
 * Aggregates models from many vendors behind an OpenAI-compatible API:
 *   POST {base}/chat/completions
 *   GET  {base}/models
 * Auth: `Authorization: Bearer <key>`.
 * Model ids look like "anthropic/claude-sonnet-4", "openai/gpt-5", …
 */

import { type ChatRequest, type ChatResponse, type Model } from "../../types/index.js";
import { OpenAiProvider } from "../openai/openai.provider.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export class OpenRouterProvider extends OpenAiProvider {
  override readonly id = "openrouter";
  override readonly name = "OpenRouter";
  override readonly defaultModel = "openrouter/auto";

  protected override defaultBaseUrl(): string {
    return DEFAULT_BASE_URL;
  }

  /** OpenRouter encourages identifying the app via headers. */
  protected override contentTypeHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/coder-cli/coder",
      "X-Title": "CODER",
    };
  }

  override parseModels(json: unknown): Model[] {
    const data = (json as { data?: Array<Record<string, unknown>> })?.data ?? [];
    const models: Model[] = [];
    for (const m of data) {
      const id = m.id;
      if (typeof id !== "string" || id.length === 0) continue;
      const architecture = m.architecture as Record<string, unknown> | undefined;
      models.push({
        id,
        provider: this.id,
        contextWindow: typeof m.context_length === "number" ? m.context_length : 0,
        supportsTools: architecture?.tool_use === true,
        name: typeof m.name === "string" ? m.name : id,
        description: typeof m.description === "string" ? m.description : undefined,
      });
    }
    return models;
  }
}
