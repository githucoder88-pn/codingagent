# CODER

**A lightweight, extensible, globally installed AI coding assistant.**

**Version 0.2.0 — Phase 2 (Data, Auth, and Control Plane)**

CODER is a command-line AI assistant that talks to OpenAI, Anthropic, Gemini
and OpenRouter from your terminal — and now it is also a **platform**: secure
accounts, encrypted key storage, an owned backend + database, prompt /
response / feedback recording, opt-in training data, admin tooling and a web
dashboard.

```console
$ npm install -g coder

$ coder signup                      # create your account
$ coder login
$ coder auth add openrouter         # key encrypted locally + on the backend
$ coder settings privacy on         # explicit privacy control
$ coder ask "Build a Todo application."
$ coder feedback 5 "Worked well"
$ coder dashboard                   # web control center
```

## Phase 1 (foundation) still works exactly as before

```console
$ coder auth add openai --key sk-...
$ coder models
$ coder model use anthropic/claude-sonnet-4
$ coder ask "Build a Todo application."
$ coder chat                        # Ink TUI / REPL, streaming
```

All Phase 1 behavior (providers, sessions, config, themes, logging, offline
mock provider) is unchanged. Phase 2 layers accounts and a control plane on
top — you can use CODER fully offline without an account.

## What Phase 2 adds

| Area | What you get |
| --- | --- |
| **Accounts** | `coder signup` / `coder login` / `coder logout` / `coder delete-account`; sessions in `~/.coder/session.json` (0600) |
| **Encrypted keys** | Provider keys encrypted with AES-256-GCM in the local vault **and** on the backend (master keys never in the DB) |
| **Backend** | `coder server start` — SQLite control plane at `127.0.0.1:8747` (users, keys, prompts, responses, feedback, audit logs, training consent, usage) |
| **Recording** | Every ask/chat turn is stored locally and synced (idempotent, offline-tolerant) when signed in |
| **Feedback** | `coder feedback 1-5 "comment"` — attaches to the last response, synced to the backend |
| **Privacy** | `coder settings privacy on\|off`, `coder privacy history\|training on\|off` — history recording and training opt-in are explicit, configurable, revocable |
| **History** | `coder history` (local) and `coder history --remote` (backend) |
| **Export / erasure** | `coder export` (JSON bundle, keys only as fingerprints) and `coder delete-account` (cascade erase) |
| **Dashboard** | `coder dashboard` opens the web UI: history, keys, settings, feedback, export; admin views for users / prompts / feedback / logs / training / usage |
| **Admin** | `coder admin users\|prompts\|feedback\|logs\|training\|usage\|models\|rotate-key\|sync` (admin role required) |
| **Auth options** | Email/password (scrypt) plus optional Firebase Auth (RS256 ID-token verification) |
| **Key rotation** | `coder admin rotate-key` — versioned envelopes, archived keys, re-encrypts everything (superadmin) |

## Quick start (Phase 2)

```console
coder server start                 # start the control plane (auto-starts with `coder dashboard`)
coder signup --email you@example.com --password ...
coder login
coder auth add openrouter          # encrypted locally + on the backend
coder settings privacy on          # or: coder privacy training on (opt-in)
coder ask "Build a Todo application."
coder feedback 5 "Worked well"
coder history --remote             # see it in the backend
coder dashboard                    # open the web dashboard
coder admin users                  # (admin accounts only)
coder export                       # your data, JSON
coder delete-account --yes         # permanent erasure
```

## Commands

```
coder chat                          Interactive chat (Ink TUI / REPL)
coder ask <prompt…>                 One-shot prompt (continues current session)
coder signup | login | logout       Account management
coder auth add <provider>           Store an API key (encrypted, synced)
coder auth list | status | remove
coder models [--provider <id>] [--refresh]
coder model use <model-id> | current | list
coder provider list | current | use <provider-id>
coder settings [show|set|privacy|history|training]
coder privacy [status|history|training]
coder feedback <1-5> [comment]
coder history [--remote] [--limit N] [--json]
coder sync                          Push local records + keys to the backend
coder export [--out file] [--local-only]
coder dashboard [--port N] [--no-open]
coder server start | status | stop
coder admin <users|prompts|feedback|logs|training|usage|rotate-key|sync>
coder sessions list | current | show <id> | remove <id>
coder clear                         Reset the current session's messages
coder config show | get <key> | set <key> <value> | path
coder delete-account [--yes]
coder help
```

## Requirements

- Node.js **22.13+** (uses built-in `node:sqlite` and `node:crypto`; no
  native modules)
- An API key for at least one provider (or the offline `mock` provider)

## Development

```console
npm install
npm run dev -- ask "hello"          # run from source (tsx)
npm run typecheck
npm test                            # 168 unit + integration + e2e tests
npm run smoke                       # Phase 1 exit criteria
npm run smoke:phase2                # Phase 2 exit example
npm run build                       # dist/cli.js + dist/server.js + dist/web
```

## Documentation

- [Architecture](docs/architecture.md) — modules, flow, extension points
- [Getting started](docs/getting-started.md) — install, auth, chat
- [Providers](docs/providers.md) — wire formats, adding a provider
- [Configuration](docs/configuration.md) — config file, env vars, sessions, logging
- [Security model](docs/security.md) — encryption, hashing, auth, privacy, training policy
- [Backend API](docs/backend-api.md) — full control-plane API reference

## License

MIT
