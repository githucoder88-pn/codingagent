/**
 * CODER — provider contract.
 *
 * The `Provider` interface is the extension point of the application: any
 * provider that implements it (plus a small registry entry) is available to
 * every command. See docs/providers.md for the "how to add a provider" guide.
 */

import { type ChatRequest, type ChatResponse, type Model } from "../../types/index.js";

export interface Provider {
  /** Stable identifier, e.g. "openrouter". Used in config and CLI flags. */
  readonly id: string;
  /** Display name, e.g. "OpenRouter". */
  readonly name: string;
  /** Model used when the user has not selected one. */
  readonly defaultModel: string;
  /** Whether this provider needs an API key stored via `coder auth`. */
  readonly requiresKey: boolean;

  /** Called once at startup; providers may resolve base URLs etc. */
  initialize(): Promise<void>;

  /**
   * Validate an API key against the provider. Returns true when the key
   * works. Network failures return false (caller decides what to store).
   */
  authenticate(apiKey: string): Promise<boolean>;

  /** Fetch the provider's model catalogue (uncached). */
  listModels(): Promise<Model[]>;

  /** Offline fallback catalogue (used when the API is unreachable). */
  fallbackModels?(): Model[];

  /** Single round-trip chat completion (non-streaming). */
  chat(request: ChatRequest): Promise<ChatResponse>;

  /** Streaming chat: yields content deltas as they arrive. */
  stream(request: ChatRequest): AsyncGenerator<string>;
}
