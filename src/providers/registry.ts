/**
 * CODER — provider registry.
 *
 * The single entry point for provider access. Registers provider instances,
 * resolves the active provider/model from settings, lists models (with
 * caching and offline fallback) and dispatches chat/stream calls.
 */

import { MODELS_CACHE_TTL_MS } from "../core/constants/index.js";
import { ConfigError } from "../core/errors/index.js";
import { type ChatRequest, type ChatResponse, type Model } from "../types/index.js";
import { type Provider } from "./base/provider.interface.js";
import { ModelCache } from "./model-cache.js";

export interface ResolvedProvider {
  provider: Provider;
  model: string;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, Provider>();

  constructor(private readonly modelCache: ModelCache) {}

  register(provider: Provider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`ProviderRegistry: duplicate provider id "${provider.id}"`);
    }
    this.providers.set(provider.id, provider);
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  get(id: string): Provider {
    const provider = this.providers.get(id);
    if (!provider) {
      const known = [...this.providers.keys()].join(", ");
      throw new ConfigError(`Unknown provider "${id}". Available providers: ${known}`);
    }
    return provider;
  }

  list(): Provider[] {
    return [...this.providers.values()];
  }

  async initializeAll(): Promise<void> {
    for (const provider of this.providers.values()) {
      await provider.initialize();
    }
  }

  /** Resolve provider + model from application settings. */
  resolve(providerId: string, modelId: string | null | undefined): ResolvedProvider {
    const provider = this.get(providerId);
    const model = modelId ?? provider.defaultModel;
    return { provider, model };
  }

  /**
   * List models for a provider. Uses the cache unless `refresh` is set or the
   * cache is stale. When the network fails, a stale cache is returned with a
   * warning flag; when nothing is cached, a built-in fallback catalogue is
   * used (see providers/known-models.ts).
   */
  async listModels(providerId: string, opts?: { refresh?: boolean; log?: (msg: string) => void }): Promise<Model[]> {
    const provider = this.get(providerId);
    const log = opts?.log ?? (() => {});

    if (!opts?.refresh) {
      const cached = await this.modelCache.get(providerId);
      if (cached) {
        const age = Date.now() - new Date(cached.fetchedAt).getTime();
        if (age < MODELS_CACHE_TTL_MS) return cached.models;
        log(`Model catalogue is ${Math.round(age / 1000)}s old; refreshing…`);
      }
    }

    try {
      const fresh = await provider.listModels();
      await this.modelCache.set(providerId, fresh);
      return fresh;
    } catch (err) {
      const cached = await this.modelCache.get(providerId);
      if (cached) {
        log(`Could not refresh models (${(err as Error).message}); using cached catalogue from ${cached.fetchedAt}.`);
        return cached.models;
      }
      const fallback = provider.fallbackModels?.() ?? [];
      if (fallback.length > 0) {
        log(`Could not fetch models (${(err as Error).message}); using the built-in offline catalogue.`);
        return fallback;
      }
      throw err;
    }
  }

  async chat(providerId: string, request: ChatRequest): Promise<ChatResponse> {
    return this.get(providerId).chat(request);
  }

  async *stream(providerId: string, request: ChatRequest): AsyncGenerator<string> {
    yield* this.get(providerId).stream(request);
  }
}
