/**
 * CODER — base provider.
 *
 * Implements the shared plumbing for HTTP-based providers: authentication
 * headers, JSON request/response handling, SSE streaming and error mapping.
 * Subclasses only implement the wire-format translation (payload builder,
 * response/stream parsers, model catalogue parser).
 */

import { ConfigManager } from "../../config/manager/config-manager.js";
import { AuthError, ProviderError } from "../../core/errors/index.js";
import { type ChatRequest, type ChatResponse, type Model, type ProviderAccount } from "../../types/index.js";
import { SSE_DONE, SseDecoder } from "../../utils/sse.js";
import { HttpClient } from "../http-client.js";
import { type Provider } from "./provider.interface.js";
import { lookupKnownModel, FALLBACK_MODELS } from "../known-models.js";

export abstract class BaseProvider implements Provider {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly defaultModel: string;
  abstract readonly requiresKey: boolean;

  constructor(
    protected readonly config: ConfigManager,
    protected readonly http: HttpClient,
  ) {}

  // ------------------------------------------------------------- endpoints

  /** Default base URL (may be overridden per-account via `coder auth --base-url`). */
  protected abstract defaultBaseUrl(): string;

  protected account(): ProviderAccount | undefined {
    return this.config.getAccount(this.id);
  }

  protected baseUrl(): string {
    return this.account()?.baseUrl ?? this.defaultBaseUrl();
  }

  protected apiKey(): string {
    return this.config.getApiKey(this.id);
  }

  /** Full chat endpoint for a model (streaming may use a different one). */
  abstract chatEndpoint(model: string): string;
  /** Full streaming endpoint; defaults to the chat endpoint. */
  protected streamEndpoint(model: string): string {
    return this.chatEndpoint(model);
  }
  /** Full endpoint returning the model catalogue. */
  abstract modelsEndpoint(): string;

  // --------------------------------------------------------- wire format

  /** Build the provider-specific JSON payload for a chat request. */
  abstract buildChatPayload(request: ChatRequest): unknown;

  /** Translate a non-streaming response JSON body into a ChatResponse. */
  abstract parseChatResponse(json: unknown, request: ChatRequest): ChatResponse;

  /** Translate one SSE data payload into a text delta (null = no text). */
  abstract parseStreamData(data: string): string | null;

  /** Translate the model catalogue JSON body into Model[]. */
  abstract parseModels(json: unknown): Model[];

  /** HTTP headers for authenticated requests (override for x-api-key etc.). */
  protected authHeaders(apiKey: string): Record<string, string> {
    return { Authorization: `Bearer ${apiKey}` };
  }

  protected contentTypeHeaders(): Record<string, string> {
    return { "Content-Type": "application/json" };
  }

  // ------------------------------------------------------------- lifecycle

  async initialize(): Promise<void> {
    // Base: nothing to do; subclasses may validate or warm up caches.
  }

  async authenticate(apiKey: string): Promise<boolean> {
    try {
      const res = await this.http.request(this.modelsEndpoint(), {
        headers: this.authHeaders(apiKey),
      });
      return res.ok;
    } catch {
      return false; // network problems must not be reported as "invalid key"
    }
  }

  // ----------------------------------------------------------------- chat

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const res = await this.http.request(this.chatEndpoint(request.model), {
      method: "POST",
      headers: { ...this.authHeaders(this.apiKey()), ...this.contentTypeHeaders() },
      body: JSON.stringify(this.buildChatPayload(request)),
    });
    if (!res.ok) this.throwHttpError(res.status, res.body);
    return this.parseChatResponse(res.body, request);
  }

  async *stream(request: ChatRequest): AsyncGenerator<string> {
    const controller = new AbortController();
    let res: Response;
    try {
      res = await this.http.requestRaw(this.streamEndpoint(request.model), {
        method: "POST",
        headers: { ...this.authHeaders(this.apiKey()), ...this.contentTypeHeaders() },
        body: JSON.stringify(this.buildChatPayload(request)),
      });
    } catch (err) {
      throw err;
    }
    if (!res.ok || !res.body) {
      const body = res.body ? await res.text() : "";
      this.throwHttpError(res.status, body);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const sse = new SseDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const event of sse.push(decoder.decode(value, { stream: true }))) {
          if (event.data.trim() === SSE_DONE) return;
          const delta = this.parseStreamData(event.data);
          if (delta) yield delta;
        }
      }
      for (const event of sse.end()) {
        if (event.data.trim() === SSE_DONE) return;
        const delta = this.parseStreamData(event.data);
        if (delta) yield delta;
      }
    } catch (err) {
      if (controller.signal.aborted) {
        throw new ProviderError("Stream aborted by the user.");
      }
      throw err;
    } finally {
      controller.abort();
      try {
        await reader.cancel();
      } catch {
        /* best effort */
      }
    }
  }

  // --------------------------------------------------------------- errors

  protected throwHttpError(status: number, body: unknown): never {
    const message = extractErrorMessage(body, status);
    if (status === 401 || status === 403) {
      throw new AuthError(
        `Provider "${this.id}" rejected the API key (HTTP ${status}): ${message} ` +
          `Run \`coder auth ${this.id}\` to update it.`,
      );
    }
    throw new ProviderError(`Provider "${this.id}" returned HTTP ${status}: ${message}`);
  }

  // -------------------------------------------------------------- models

  /** Fetch and parse the provider's model catalogue. */
  async listModels(): Promise<Model[]> {
    const res = await this.http.request(this.modelsEndpoint(), {
      headers: this.authHeaders(this.apiKey()),
    });
    if (!res.ok) this.throwHttpError(res.status, res.body);
    return this.parseModels(res.body);
  }

  /** Offline fallback catalogue from known model metadata. */
  fallbackModels(): Model[] {
    const ids = FALLBACK_MODELS[this.id];
    return ids ? this.enrichModels(ids) : [];
  }

  protected enrichModels(ids: string[]): Model[] {
    return ids.map((id) => {
      const known = lookupKnownModel(id);
      return {
        id,
        provider: this.id,
        contextWindow: known?.contextWindow ?? 0,
        supportsTools: known?.supportsTools ?? false,
        name: id,
      };
    });
  }
}

/** Pull a human-readable message out of provider error bodies. */
function extractErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const err = obj.error as Record<string, unknown> | undefined;
    if (err && typeof err.message === "string") return err.message;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.error === "string") return obj.error;
  }
  if (typeof body === "string" && body.trim() !== "") return body.slice(0, 300);
  return `no error details (HTTP ${status})`;
}
