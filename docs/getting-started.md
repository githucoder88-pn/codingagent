# Getting started

## 1. Install

```console
npm install -g coder
coder --version
```

Requirements: **Node.js ≥ 22.13** (uses the built-in `node:sqlite` — no
native modules, works on macOS / Linux / Windows).

## 2. Authenticate a provider

```console
coder auth openrouter
```

You will be prompted for an API key (input is hidden). To authenticate
non-interactively (scripts, CI):

```console
coder auth openai --key sk-...
coder auth anthropic --key sk-ant-...
coder auth gemini --key AIza...
coder auth openrouter --key sk-or-...
```

Keys are stored in `~/.coder/providers.json` with 0600 permissions. Check
state with:

```console
coder auth status
coder auth list
coder auth remove openai
```

Advanced: point a provider at a custom endpoint (proxies, self-hosted
gateways):

```console
coder auth openai --key sk-... --base-url https://my-proxy.example.com/v1
```

## 3. Pick a provider and model

```console
coder provider list                 # see what's available
coder provider use openrouter       # switch provider

coder models                        # list models (cached 24 h)
coder models --refresh              # force a fresh fetch
coder model use anthropic/claude-sonnet-4
coder model current
```

The default provider is `openrouter` and the default model is the provider's
own default. Everything is stored in `~/.coder/config.json`.

## 4. Chat

One-shot prompt (continues the current session automatically):

```console
coder ask "Build a Todo application."
coder ask "Now add a CLI for it."           # same conversation
coder ask --json "What is 2+2?"             # machine-readable output
coder ask --no-stream "…"                   # single response, no streaming
```

Interactive session:

```console
coder chat
```

```
╭─────────────────────────────────────╮
│ CODER                               │
│ Provider : OpenRouter               │
│ Model    : Claude Sonnet            │
│ Session  : session-001              │
╰─────────────────────────────────────╯

> Build a web server.
```

Slash commands inside `coder chat`:

| Command | Action |
| --- | --- |
| `/help` | list commands |
| `/exit`, `/quit` | leave the chat |
| `/clear` | wipe the current session's messages |
| `/new` | start a fresh session |
| `/model <id>` | switch model (persisted) |
| `/provider <id>` | switch provider (persisted) |
| `/sessions` | show the current session id |

## 5. Sessions

Conversations are saved automatically as JSON:

```console
coder sessions list          # all sessions, newest first
coder sessions show session-001
coder sessions current
coder sessions remove session-001
coder clear                  # empty the current session
```

## 6. Try it without an API key

The built-in `mock` provider is fully offline:

```console
coder provider use mock
coder ask "hello"
```

Useful for demos, CI and development.

## 7. Troubleshooting

| Problem | Fix |
| --- | --- |
| `Unknown provider` | Run `coder provider list` for valid ids. |
| `No API key stored` (exit 3) | Run `coder auth <provider>`. |
| `HTTP 401/403` (exit 3) | Key rejected — re-run `coder auth <provider>`. |
| Network failures (exit 4) | Check connectivity; `coder models` falls back to the cached/offline catalogue with a warning. |
| `coder ask` returns nothing | Check `~/.coder/logs/debug.log` and run with `CODER_DEBUG=1`. |

Exit codes: `0` ok · `2` usage · `3` auth · `4` network · `5` provider · `6` config.
