/**
 * CODER — OpenAI-compatible providers (Phase 8).
 *
 * Many providers (groq, deepseek, together, xai, cohere, ollama, litellm,
 * bedrock via a gateway) speak the OpenAI Chat Completions wire format with
 * a different base URL. This thin subclass configures an OpenAI provider by
 * id/name/baseUrl so we register 13+ providers from one implementation.
 *
 * Azure is special: `x-api-key` auth + `?api-version=` query suffix. It
 * extends this class and overrides the auth header + endpoint builder.
 */

import { OpenAiProvider } from "./openai/openai.provider.js";
import { type Model } from "../types/index.js";

export interface CompatibleProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  defaultModel: string;
  /** When false the provider is usable without a stored key (e.g. ollama). */
  requiresKey?: boolean;
  /** Optional offline fallback catalogue. */
  models?: Model[];
}

export class OpenAiCompatibleProvider extends OpenAiProvider {
  override readonly id: string;
  override readonly name: string;
  override readonly defaultModel: string;
  override readonly requiresKey: boolean;
  private readonly cfg: CompatibleProviderConfig;

  constructor(
    config: ConstructorParameters<typeof OpenAiProvider>[0],
    http: ConstructorParameters<typeof OpenAiProvider>[1],
    cfg: CompatibleProviderConfig,
  ) {
    super(config, http);
    this.cfg = cfg;
    this.id = cfg.id;
    this.name = cfg.name;
    this.defaultModel = cfg.defaultModel;
    this.requiresKey = cfg.requiresKey ?? true;
  }

  protected override defaultBaseUrl(): string {
    return this.cfg.baseUrl;
  }

  override fallbackModels(): Model[] {
    return this.cfg.models ?? [];
  }
}

/**
 * Azure OpenAI: `x-api-key` header and a `?api-version=` query suffix on
 * every endpoint.
 */
export class AzureOpenAiProvider extends OpenAiCompatibleProvider {
  private readonly apiVersion: string;

  constructor(
    config: ConstructorParameters<typeof OpenAiProvider>[0],
    http: ConstructorParameters<typeof OpenAiProvider>[1],
    cfg: CompatibleProviderConfig & { apiVersion?: string },
  ) {
    super(config, http, cfg);
    this.apiVersion = cfg.apiVersion ?? "2024-10-21";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override chatEndpoint(model: string): string {
    return `${this.baseUrl()}/openai/deployments/${model}/chat/completions?api-version=${this.apiVersion}`;
  }

  override modelsEndpoint(): string {
    return `${this.baseUrl()}/openai/models?api-version=${this.apiVersion}`;
  }

  protected override authHeaders(apiKey: string): Record<string, string> {
    return { "x-api-key": apiKey };
  }
}
