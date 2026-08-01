/**
 * CODER — known model metadata.
 *
 * Providers like OpenAI expose model ids without context-window information.
 * This map enriches those listings with best-effort values (used only when
 * the provider's own catalogue does not carry the field). It also serves as
 * the offline fallback catalogue when the network is unavailable.
 */

export interface KnownModelInfo {
  contextWindow: number;
  supportsTools: boolean;
}

export const KNOWN_MODELS: Record<string, KnownModelInfo> = {
  // OpenAI (GPT + O-series)
  "gpt-5": { contextWindow: 400_000, supportsTools: true },
  "gpt-5-mini": { contextWindow: 400_000, supportsTools: true },
  "gpt-5-nano": { contextWindow: 400_000, supportsTools: true },
  "gpt-4.1": { contextWindow: 1_000_000, supportsTools: true },
  "gpt-4.1-mini": { contextWindow: 1_000_000, supportsTools: true },
  "gpt-4.1-nano": { contextWindow: 1_000_000, supportsTools: true },
  "gpt-4o": { contextWindow: 128_000, supportsTools: true },
  "gpt-4o-mini": { contextWindow: 128_000, supportsTools: true },
  "gpt-4-turbo": { contextWindow: 128_000, supportsTools: true },
  "gpt-4": { contextWindow: 8_192, supportsTools: true },
  "gpt-3.5-turbo": { contextWindow: 16_385, supportsTools: false },
  "o3": { contextWindow: 200_000, supportsTools: true },
  "o3-mini": { contextWindow: 200_000, supportsTools: true },
  "o4-mini": { contextWindow: 200_000, supportsTools: true },
  "o1": { contextWindow: 200_000, supportsTools: false },
  "o1-mini": { contextWindow: 128_000, supportsTools: false },

  // Anthropic
  "claude-opus-4": { contextWindow: 200_000, supportsTools: true },
  "claude-opus-4-1": { contextWindow: 200_000, supportsTools: true },
  "claude-sonnet-4": { contextWindow: 200_000, supportsTools: true },
  "claude-sonnet-4-5": { contextWindow: 200_000, supportsTools: true },
  "claude-3-7-sonnet": { contextWindow: 200_000, supportsTools: true },
  "claude-3-5-sonnet": { contextWindow: 200_000, supportsTools: true },
  "claude-3-5-haiku": { contextWindow: 200_000, supportsTools: true },
  "claude-3-opus": { contextWindow: 200_000, supportsTools: true },
  "claude-3-haiku": { contextWindow: 200_000, supportsTools: true },
  "claude-2.1": { contextWindow: 200_000, supportsTools: false },

  // Gemini
  "gemini-2.5-pro": { contextWindow: 1_000_000, supportsTools: true },
  "gemini-2.5-flash": { contextWindow: 1_000_000, supportsTools: true },
  "gemini-2.5-flash-lite": { contextWindow: 1_000_000, supportsTools: true },
  "gemini-2.0-flash": { contextWindow: 1_000_000, supportsTools: true },
  "gemini-2.0-flash-lite": { contextWindow: 1_000_000, supportsTools: true },
  "gemini-1.5-pro": { contextWindow: 2_000_000, supportsTools: true },
  "gemini-1.5-flash": { contextWindow: 1_000_000, supportsTools: true },
  "gemini-1.5-flash-8b": { contextWindow: 1_000_000, supportsTools: true },
};

export function knownModelInfo(id: string): KnownModelInfo {
  return (
    KNOWN_MODELS[id] ?? { contextWindow: 0, supportsTools: false }
  );
}

/** Look up metadata, also trying the bare model name ("vendor/model"). */
export function lookupKnownModel(id: string): KnownModelInfo | undefined {
  const direct = KNOWN_MODELS[id];
  if (direct) return direct;
  if (id.includes("/")) {
    const bare = KNOWN_MODELS[id.slice(id.lastIndexOf("/") + 1)];
    if (bare) return bare;
  }
  return undefined;
}

/** Offline fallback catalogues per provider (used when the API is unreachable). */
export const FALLBACK_MODELS: Record<string, string[]> = {
  openai: [
    "gpt-5",
    "gpt-5-mini",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "gpt-4o",
    "gpt-4o-mini",
    "o3",
    "o4-mini",
  ],
  anthropic: [
    "claude-opus-4",
    "claude-sonnet-4",
    "claude-sonnet-4-5",
    "claude-3-7-sonnet",
    "claude-3-5-sonnet",
    "claude-3-5-haiku",
  ],
  gemini: [
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
  ],
  openrouter: [
    "anthropic/claude-opus-4",
    "anthropic/claude-sonnet-4",
    "openai/gpt-5",
    "openai/gpt-4.1",
    "google/gemini-2.5-pro",
    "google/gemini-2.5-flash",
  ],
};
