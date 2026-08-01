# CODER

**A lightweight, extensible, globally installed AI coding assistant.**

**Version 0.1.0 — Phase 1 (Foundation Layer)**

CODER is a command-line AI assistant that talks to OpenAI, Anthropic, Gemini
and OpenRouter from your terminal. Phase 1 lays the foundation: global
installation, provider authentication, model selection, interactive + one-shot
chat with streaming, and persistent conversation history.

```console
$ npm install -g coder

$ coder auth openrouter
Enter API key for OpenRouter (input hidden): ████████████████
✓ API key for OpenRouter stored and verified.

$ coder models
MODEL                          PROVIDER    CONTEXT  TOOLS
anthropic/claude-sonnet-4      openrouter  200000   yes
openai/gpt-5                   openrouter  400000   yes
…

$ coder model use anthropic/claude-sonnet-4
✓ Active model set to anthropic/claude-sonnet-4 (OpenRouter).

$ coder ask "Build a Todo application."
Here is a Todo application…
```

## Features (Phase 1)

| Area | What you get |
| --- | --- |
| **Providers** | OpenAI (GPT + O-series), Anthropic (Claude), Gemini, OpenRouter, plus a built-in offline `mock` provider for demos/tests |
| **Auth** | `coder auth <provider>` with hidden input or `--key` for scripts; keys stored in `~/.coder/providers.json` (0600) |
| **Chat** | `coder chat` (interactive, streaming, slash commands), `coder ask "…"` (one-shot, JSON output available) |
| **Models** | `coder models`, `coder model use <id>`, `coder model current` — cached 24 h in SQLite, offline fallback catalogue |
| **Sessions** | Every conversation saved automatically to `~/.coder/sessions/session-NNN.json`; `coder sessions list/show/remove`, `coder clear` |
| **Config** | `~/.coder/config.json` + environment overrides (`CODER_PROVIDER`, `CODER_MODEL`, `CODER_STREAM`, `CODER_THEME`, `CODER_HOME`) |
| **Logging** | `~/.coder/logs/{debug,error,latest}.log` (pino JSON, rotating) |
| **UI** | Ink-based TUI on real terminals, readline REPL everywhere else, themes (`default`, `dark`, `light`, `none`) |

## Quick start

```console
npm install -g coder        # global executable: coder

coder auth openrouter       # or: openai | anthropic | gemini
coder models                # list models for the active provider
coder model use anthropic/claude-sonnet-4
coder ask "Build a Todo application."
coder chat                  # interactive session
```

No API key handy? Every command works offline against the built-in mock
provider:

```console
coder provider use mock
coder ask "hello"
```

## Commands

```
coder chat                          Interactive chat (Ink TUI / REPL)
coder ask <prompt…>                 One-shot prompt (continues current session)
coder auth <provider>               Store an API key  (--key, --base-url)
coder auth list | status | remove <provider>
coder models [--provider <id>] [--refresh]
coder model use <model-id> | current | list
coder provider list | current | use <provider-id>
coder sessions list | current | show <id> | remove <id>
coder clear                         Reset the current session's messages
coder config show | get <key> | set <key> <value> | path
coder help                          Extended help
```

## Requirements

- Node.js **22.13+** (uses the built-in `node:sqlite`; no native modules)
- An API key for at least one provider

## Development

```console
npm install
npm run dev -- ask "hello"          # run from source (tsx)
npm run typecheck                   # tsc --noEmit
npm test                            # unit + integration + e2e (builds first)
npm run smoke                       # build + exit-criteria smoke test
npm run build                       # bundle to dist/ (tsup)
```

## Documentation

- [Architecture](docs/architecture.md) — modules, flow, extension points
- [Getting started](docs/getting-started.md) — install, auth, chat
- [Providers](docs/providers.md) — wire formats, auth, adding a provider
- [Configuration](docs/configuration.md) — config file, env vars, sessions, logging

## License

MIT
