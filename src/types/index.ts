/**
 * CODER — shared domain types.
 *
 * These types form the provider-agnostic contract used across the
 * application. Provider implementations translate between these types and
 * their own wire format (see src/providers/*).
 */

/** Roles understood by every provider. */
export type MessageRole = "system" | "user" | "assistant" | "tool";

/** A single conversation message in the neutral format. */
export interface ChatMessage {
  role: MessageRole;
  content: string;
}

/** Provider-agnostic chat request. */
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** Ask the provider to stream token-by-token (see `Provider.stream`). */
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
}

/** Token usage reported by a provider (fields optional — providers differ). */
export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
}

/** Provider-agnostic (non-streamed) chat response. */
export interface ChatResponse {
  id: string;
  model: string;
  content: string;
  usage: Usage;
  createdAt: string;
}

/** A model as exposed by a provider. */
export interface Model {
  id: string;
  provider: string;
  contextWindow: number;
  supportsTools: boolean;
  /** Human friendly name, when the provider exposes one. */
  name?: string;
  description?: string;
}

/** Stored credentials for one provider (kept in ~/.coder/providers.json). */
export interface ProviderAccount {
  apiKey: string;
  baseUrl?: string;
  configuredAt: string;
}

/** A conversation stored on disk (see ~/.coder/sessions/session-*.json). */
export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  provider: string;
  model: string;
  messages: ChatMessage[];
}

/** Resolved application settings (config file merged with environment). */
export interface AppSettings {
  provider: string;
  model: string | null;
  theme: string;
  stream: boolean;
}

/** Result of a `coder ask` run, used by tests and callers. */
export interface AskResult {
  session: Session;
  response: ChatResponse;
  streamed: boolean;
}

/** Kinds of events emitted by the interactive chat screen. */
export type ChatScreenEvent =
  | { type: "message"; role: MessageRole; content: string }
  | { type: "exit" }
  | { type: "clear" }
  | { type: "new-session" }
  | { type: "error"; message: string };
