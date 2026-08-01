# Providers

Phase 1 ships five providers. All of them implement the same contract, so
commands behave identically across providers.

| Provider | Id | API | Default model | Notes |
| --- | --- | --- | --- | --- |
| OpenAI | `openai` | Chat Completions | `gpt-4o-mini` | GPT + O-series |
| Anthropic | `anthropic` | Messages API | `claude-sonnet-4` | Claude models |
| Gemini | `gemini` | Generative Language API | `gemini-2.5-flash` | Gemini models |
| OpenRouter | `openrouter` | OpenAI-compatible | `openrouter/auto` | Aggregates vendors |
| Mock | `mock` | — | `mock/coder-1` | Offline; tests/demos |

## The provider contract

```ts
export interface Provider {
  id: string;
  name: string;
  defaultModel: string;
  requiresKey: boolean;

  initialize(): Promise<void>;
  authenticate(apiKey: string): Promise<boolean>;
  listModels(): Promise<Model[]>;
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncGenerator<string>;
}
```

`BaseProvider` implements the shared HTTP/SSE plumbing (auth headers, JSON
requests, streaming, error mapping, model enrichment); subclasses only
translate wire formats:

| Method | Responsibility |
| --- | --- |
| `buildChatPayload(request)` | Request JSON for the provider |
| `parseChatResponse(json, request)` | Response JSON → `ChatResponse` |
| `parseStreamData(data)` | One SSE `data:` payload → text delta (or `null`) |
| `parseModels(json)` | Catalogue JSON → `Model[]` |
| `chatEndpoint(model)` / `streamEndpoint(model)` | Endpoint URLs |
| `modelsEndpoint()` | Catalogue URL |
| `authHeaders(key)` | Auth headers (`Bearer`, `x-api-key`, `x-goog-api-key`) |

## Wire formats

- **OpenAI / OpenRouter** — `POST {base}/chat/completions`, `GET {base}/models`;
  streaming via SSE `data:` chunks with `choices[0].delta.content` and a
  `[DONE]` terminator. OpenRouter adds `HTTP-Referer` / `X-Title` headers and
  exposes `context_length` + `architecture.tool_use` per model.
- **Anthropic** — `POST {base}/messages` with `x-api-key` +
  `anthropic-version: 2023-06-01`; system prompts are extracted into the
  `system` field; streaming events carry text in
  `content_block_delta → delta.text`.
- **Gemini** — `POST {base}/models/{model}:generateContent` and
  `:streamGenerateContent?alt=sse`, auth via `x-goog-api-key`; roles are
  `user`/`model`, system instructions go to `systemInstruction`.

## Model catalogues

`coder models` fetches the provider catalogue and caches it in SQLite for
24 hours (`coder models --refresh` forces a refetch). When the network is
unavailable:

1. a stale cache is used (with a warning), or
2. a built-in fallback catalogue (`src/providers/known-models.ts`) is used.

Context-window metadata from `known-models.ts` enriches listings whose API
does not provide it (e.g. OpenAI).

## Auth

`coder auth <provider>` stores the key in `~/.coder/providers.json`
(0600) and verifies it by calling the provider's catalogue endpoint.
`--base-url` overrides the default endpoint per account. A key that cannot
be verified is still stored, with a warning (offline-friendly).

## Adding a provider

1. Create `src/providers/<name>/<name>.provider.ts` extending
   `BaseProvider` (see `openai/` as the template for OpenAI-compatible APIs,
   `anthropic/` or `gemini/` for other styles).
2. Implement the wire-format methods listed above.
3. Register it in `buildContainer()` (`src/core/application/application.ts`).
4. Add it to `PROVIDER_IDS` in `src/core/constants/index.ts`.
5. Add a fallback model list in `known-models.ts` (optional but recommended).
6. Add unit tests (`tests/unit/providers-payload.test.ts`) and integration
   tests (`tests/integration/providers-http.test.ts` with `FakeFetch`).

Every command (`ask`, `chat`, `models`, `auth`, …) picks the new provider up
automatically.
