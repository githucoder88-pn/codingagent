# CODER — Architecture

CODER is a TypeScript CLI + control plane for Node.js 22+. This document
describes the module layout, the request flows, and the extension points
that later phases build on.

## Directory layout

```
coder/
├── src/                          # Phase 1 + 2 CLI (bundled into dist/cli.js)
│   ├── commands/                 #   Commander command groups
│   │   ├── chat/  auth/  models/  provider/  config/  sessions/  help/
│   │   ├── account/              #   login, signup, logout, delete-account
│   │   ├── server/  dashboard/   #   backend lifecycle + web dashboard
│   │   ├── settings/  privacy/   #   settings + privacy controls
│   │   ├── feedback/  history/  export/  sync/
│   │   ├── admin/                #   users/prompts/feedback/logs/training/usage/rotate-key
│   │   └── index.ts              #   program builder (wiring + exit codes)
│   ├── core/                     #   application, container, lifecycle, constants, errors
│   ├── config/                   #   ConfigManager, zod schemas, defaults
│   ├── providers/                #   base, openai, anthropic, gemini, openrouter, mock,
│   │                             #   registry, model-cache, http-client, known-models
│   ├── session/                  #   storage (JSON + SQLite), history, memory
│   ├── account/                  #   Phase 2: session store, API client, encrypted
│   │                             #   key vault, records store, privacy settings, recorder
│   ├── sync/                     #   Phase 2: sync engine (records + keys → backend)
│   ├── ui/                       #   components, themes, screens (Ink TUI + REPL)
│   ├── logger/                   #   console + rotating pino file sinks
│   ├── utils/  types/  cli.ts  index.ts
├── backend/                      # Phase 2 control plane (bundled into dist/server.js)
│   ├── src/api/                  #   Express routers: auth, users, chat, admin, data
│   ├── src/auth/                 #   scrypt, JWT sessions, Firebase verification, middleware
│   ├── src/database/             #   node:sqlite schema + repositories
│   ├── src/encryption/           #   KeyManager: AES-256-GCM envelopes + rotation
│   ├── src/providers/            #   server-side chat proxy (decrypt → call → discard)
│   ├── src/config.ts  server.ts  #   env config + Express composition
│   └── src/index.ts              #   entry (node dist/server.js)
├── shared/                       # Phase 2 shared library (no build step)
│   └── src/                      #   types, zod schemas, crypto primitives, constants
├── web/                          # Phase 2 dashboard SPA (copied into dist/ at build)
│   ├── index.html  app.js  styles.css
├── tests/                        # unit/ integration/ e2e/ phase2/ + helpers/
├── docs/                         # this documentation set
├── scripts/                      # dev.mjs, smoke.mjs (Phase 1), smoke-phase2.mjs
└── package.json
```

## Request flows

### CLI chat (unchanged from Phase 1)

```
coder ask "…" → commander → bootstrap() → registry → provider.chat/stream
                                      → session store → recordTurn (Phase 2)
```

### Account + recording

```
coder login ──▶ POST /api/auth/login ──▶ session.json (0600)

coder ask "…" ──▶ provider call (local key from encrypted vault)
              ──▶ recordTurn: append ~/.coder/records.json (privacy-gated)
              ──▶ syncRecords: POST /api/chat/prompt {clientRecordId, …}
                              (idempotent; retried by `coder sync` when offline)
```

### Backend request flow

```
express ──▶ authMiddleware (Bearer → JWT → api_sessions check)
   ├── /api/auth/*        signup/login/logout/session/keys/firebase
   ├── /api/users/*       me, settings, stats
   ├── /api/chat/*        prompt (idempotent, privacy-gated), history,
   │                      feedback, completions (server-side proxy:
   │                      fetch encrypted key → KeyManager.decrypt →
   │                      provider call → plaintext discarded)
   ├── /api/admin/*       users, prompts, feedback, logs, training,
   │                      usage, rotate-key (superadmin)
   ├── /api/export, /api/delete-account
   └── / (web dashboard SPA)
```

## Key design decisions

1. **Provider contract is the extension point.** `Provider` (initialize /
   authenticate / listModels / chat / stream) is implemented by every
   provider; the registry exposes it to all commands. The `mock` provider is
   a fully offline example.

2. **Dependency injection via a tiny container.** Lazy singletons; tests
   re-register tokens to substitute doubles.

3. **Neutral types at the edges.** `ChatMessage` / `ChatRequest` /
   `ChatResponse` / `Model` are provider-agnostic; wire translation lives in
   each provider.

4. **Stability-first errors.** Every failure is a `CoderError` with a stable
   exit code: `0` ok · `2` usage · `3` auth · `4` network · `5` provider ·
   `6` config.

5. **Secrets are encrypted by default.** AES-256-GCM envelopes everywhere
   (CLI vault + backend), versioned for rotation, master keys never in the
   database. See [Security model](security.md).

6. **Offline-first with eventual sync.** The CLI works fully offline;
   records and keys sync idempotently when the backend is reachable, and
   `coder sync` retries anything queued.

7. **Privacy is enforced server-side, not just client-side.** The backend
   refuses to record prompts when history is disabled and only marks rows
   for training after explicit opt-in.

8. **UI degrades gracefully.** Ink TUI on real terminals, readline REPL
   everywhere else; the dashboard is a dependency-free SPA served by the
   backend.

## Storage layout

```
~/.coder/
├── config.json              # provider/model/theme/stream (Phase 1)
├── vault.json               # provider keys, AES-256-GCM (Phase 2)
├── keys/master.key          # local vault master key (0600)
├── session.json             # signed-in session (0600)
├── settings.json            # privacy settings (0600)
├── records.json             # local prompt/response/feedback log (0600)
├── sessions/                # Phase 1 conversation files
├── logs/                    # pino JSON logs (debug/error/latest)
├── cache/                   # SQLite cache (model catalogues, kv)
└── server/                  # backend: coder.db, master.key, jwt.secret,
                             # keys.json (rotation), server.log, server.pid
```

`CODER_HOME` relocates everything; `CODER_SERVER_DIR` relocates the backend.

## Testing strategy

- **Unit** — crypto primitives, KeyManager rotation, Firebase verification,
  container, config, session store, SSE parser, provider wire formats,
  memory, formatting.
- **Integration** — the full backend API on an ephemeral port (auth, keys,
  recording, privacy, feedback, admin, rotation, export, deletion, proxy),
  the CLI in-process against a live backend (signup → login → auth add →
  privacy → ask → feedback → history → export → admin → delete-account),
  providers against a fake fetch.
- **E2E** — spawned `dist/cli.js` + `dist/server.js`: the Phase 2 exit
  example, server lifecycle (`start/status/stop`), dashboard, and the Phase
  1 exit criteria.

## Phase 3 hooks

- `MessageRole.tool` + `Model.supportsTools` — tool-calling and agent loops.
- The sync engine becomes the transport for session sync and multi-device
  state.
- `training_consent` + `for_training` rows — the opt-in training pipeline.
- The server-side proxy is the seed of server-side orchestration and
  multi-agent routing.
- `shared/` types are the contract for skills packs, MCPs and plugins.
