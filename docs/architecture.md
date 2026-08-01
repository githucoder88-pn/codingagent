# CODER — Architecture (Phase 1)

CODER is a TypeScript CLI for Node.js 22+. This document describes the module
layout, the request flow, and the extension points that later phases build on.

## Directory layout

```
coder/
├── src/
│   ├── commands/          # Commander command groups (one dir per group)
│   │   ├── chat/          #   chat, ask, clear
│   │   ├── auth/          #   auth <provider>, list, status, remove
│   │   ├── models/        #   models, model use/current/list
│   │   ├── provider/      #   provider list/current/use
│   │   ├── config/        #   config show/get/set/path
│   │   ├── sessions/      #   sessions list/show/remove/current
│   │   ├── help/          #   extended help
│   │   └── index.ts       #   program builder (wiring + exit codes)
│   ├── core/
│   │   ├── application/   #   AppContext, createApp(), shutdownApp()
│   │   ├── container/     #   tiny DI container (lazy singletons)
│   │   ├── lifecycle/     #   bootstrap() / shutdown()
│   │   ├── constants/     #   paths, defaults, exit codes, env names
│   │   └── errors/        #   CoderError hierarchy + exit-code mapping
│   ├── config/
│   │   ├── manager/       #   ConfigManager (config.json + providers.json)
│   │   ├── schema/        #   zod schemas
│   │   └── defaults/      #   defaults + themes list
│   ├── providers/
│   │   ├── base/          #   Provider interface + BaseProvider (HTTP/SSE)
│   │   ├── openai/        #   OpenAI (also the template for OpenAI-compatible)
│   │   ├── anthropic/     #   Anthropic Messages API
│   │   ├── gemini/        #   Gemini Generative Language API
│   │   ├── openrouter/    #   OpenRouter (extends OpenAI)
│   │   ├── mock/          #   offline provider for tests/demos
│   │   ├── registry.ts    #   provider registry + model caching
│   │   ├── model-cache.ts #   SQLite-backed model catalogue cache
│   │   ├── http-client.ts #   fetch wrapper (timeouts, error mapping)
│   │   └── known-models.ts#   offline model metadata/fallback
│   ├── session/
│   │   ├── storage/       #   SessionStore (JSON files) + SqliteStore (kv/cache)
│   │   ├── history/       #   current-session pointer
│   │   └── memory/        #   in-process cache + message trimming
│   ├── ui/
│   │   ├── components/    #   banner, spinner, table, prompts
│   │   ├── themes/        #   ANSI themes + NO_COLOR handling
│   │   └── screens/       #   chat controller, REPL, Ink TUI, ask runner
│   ├── logger/
│   │   ├── console/       #   human console output
│   │   └── file/          #   pino JSON → debug/error/latest.log (rotating)
│   ├── utils/             #   paths, atomic writes, SSE parser, format
│   ├── types/             #   shared domain types
│   ├── cli.ts             #   entry point (argv → exit code)
│   └── index.ts           #   public API
├── tests/                 # unit/ integration/ e2e/ + helpers/
├── docs/                  # this documentation set
├── scripts/               # dev.mjs (tsx runner), smoke.mjs (exit-criteria)
└── package.json
```

## Request flow

```
┌────────┐   argv    ┌──────────┐   parse   ┌──────────────┐
│  coder │ ────────▶ │  cli.ts  │ ────────▶ │  Commander   │
└────────┘           └──────────┘           └──────┬───────┘
                                                    │ action
                                                    ▼
                                           ┌──────────────────┐
                                           │  bootstrap()     │  ensure ~/.coder
                                           │  createApp()     │  load config
                                           └────────┬─────────┘  open SQLite
                                                    │              init providers
                                                    ▼
                                          ┌───────────────────┐
                                          │  command handler  │  e.g. askCommand
                                          └─────────┬─────────┘
                                                    ▼
                        ┌──────────────────────────────────────────┐
                        │ runAsk: history → session → trim (memory)│
                        │        → registry → provider.chat/stream │
                        │        → save session → print result     │
                        └──────────────────────────────────────────┘
                                                    │
                                                    ▼
                                          shutdownApp(): close SQLite,
                                          flush + close loggers, exit code
```

## Key design decisions

1. **Provider contract is the extension point.** A provider implements
   `Provider` (initialize / authenticate / listModels / chat / stream),
   registers itself in `buildContainer()`, and every command works with it.
   The `mock` provider is a working example of a 100 % offline provider.

2. **Dependency injection via a tiny container.** Services are lazy
   singletons; tests re-register tokens (`container.override`) to substitute
   doubles. No framework needed.

3. **Neutral types at the edges.** `ChatMessage`, `ChatRequest`,
   `ChatResponse`, `Model` are provider-agnostic. Each provider translates to
   its wire format in one place (`buildChatPayload`, `parseChatResponse`,
   `parseStreamData`, `parseModels`), which keeps the rest of the app
   provider-ignorant.

4. **Stability-first error handling.** Every failure is a `CoderError`
   subclass with a stable exit code (see `core/constants`): `0` ok, `2` usage,
   `3` auth, `4` network, `5` provider, `6` config. Scripts can rely on them.

5. **SQLite without native modules.** Node's built-in `node:sqlite` powers
   the cache/metadata store; if it is unavailable the store degrades to a
   JSON file so the CLI never breaks on exotic platforms.

6. **UI degrades gracefully.** The interactive chat uses Ink on real
   terminals and a readline REPL everywhere else (pipes, CI, minimal
   terminals). All output is colour-safe (NO_COLOR / non-TTY aware).

## Storage layout

```
~/.coder/
├── config.json            # provider/model/theme/stream (zod-validated)
├── providers.json         # API keys + base URL overrides (0600)
├── sessions/
│   ├── current.json       # pointer to the active session
│   └── session-001.json   # one JSON file per conversation
├── logs/
│   ├── debug.log          # pino JSON, everything
│   ├── error.log          # errors only
│   └── latest.log         # most recent invocation (truncated per run)
└── cache/
    └── coder.db           # SQLite: kv metadata + model catalogue cache
```

`CODER_HOME` relocates `~/.coder` (used by tests and portable installs).

## Testing strategy

- **Unit** (`tests/unit`) — containers, config, session store, SSE parser,
  provider wire-format translations, memory trimming, formatting.
- **Integration** (`tests/integration`) — providers against an in-memory
  fake `fetch` (URLs, headers, payloads, streaming, error mapping), model
  cache behaviour, full `createApp → runAsk → persist` flows.
- **E2E** (`tests/e2e`) — spawns the built `dist/cli.js` in an isolated
  `CODER_HOME` and walks the Phase 1 exit-criteria flow with the mock
  provider.

## Phase 2 hooks

- `MessageRole` already includes `"tool"`; `Model.supportsTools` is tracked.
- `session/memory` can grow into a context-management layer.
- `SqliteStore.message_log` is a ready-made index for repository analysis.
- The registry pattern lets Phase 2 add `Agent`/`Tool` services the same way
  providers are added today.
