# Changelog

All notable changes to CODER are documented here.

## [0.2.0] — 2026-08-01

### Phase 2 — Data, Auth, and Control Plane

CODER becomes a connected platform with secure accounts, owned data, model
usage tracking, dashboard management, and a backend ready for future
training, analytics, and multi-agent features.

#### Added

- **Accounts** — `coder signup`, `coder login`, `coder logout`,
  `coder delete-account`; sessions stored in `~/.coder/session.json` (0600).
- **Backend control plane** — `coder server start|status|stop` runs a
  Node/Express + SQLite (built-in `node:sqlite`) backend on
  `127.0.0.1:8747` (configurable via `CODER_API_HOST`/`CODER_API_PORT`).
- **Encrypted key storage** — provider keys encrypted with AES-256-GCM in
  the local vault and on the backend; versioned envelopes with
  `coder admin rotate-key` (superadmin) re-encrypting all stored keys.
- **Authentication** — email/password (scrypt-hashed) with revocable JWT
  sessions; optional Firebase Auth (RS256 ID-token verification via JWKS).
- **Recording & sync** — prompts, responses, and feedback recorded locally
  (`~/.coder/records.json`) and synced idempotently to the backend;
  offline-tolerant with `coder sync` retries.
- **Feedback** — `coder feedback <1-5> [comment]` attaches ratings to the
  last response (feedback-only mode supported).
- **Privacy controls** — `coder settings privacy on|off`,
  `coder privacy history|training on|off`; history recording and training
  opt-in are explicit, configurable, and revocable, enforced server-side.
- **History & export** — `coder history [--remote]`, `coder export` (JSON
  bundle; keys exported only as fingerprints).
- **Web dashboard** — `coder dashboard` opens a dependency-free SPA
  (login/signup, usage overview, history + inline feedback, key
  management, privacy settings, export, delete; admin views for users,
  prompts, feedback, audit logs, training, usage, models).
- **Admin** — `coder admin users|prompts|feedback|logs|training|usage|
  models|rotate-key|sync` with role separation (`user`/`admin`/`superadmin`).
- **Audit logs** — security/admin actions recorded in `audit_logs`
  (survive account deletion).
- **Provider/model metadata** — usage counts and first/last-seen tracked
  per provider/model (`GET /api/admin/models`).
- **Settings sync** — login/signup/sync pull the account's server-side
  privacy settings so dashboard toggles propagate to the CLI.

#### Changed

- `coder auth <provider>` is now `coder auth add <provider>` (legacy alias
  kept); keys are stored in the encrypted vault instead of plaintext
  `providers.json`, which is migrated on first use.
- `coder ask`/`coder chat` turns are recorded and synced when signed in
  and history recording is enabled.
- Version bumped to 0.2.0; `PHASE` = "Phase 2 — Data, Auth, and Control
  Plane".

## [0.1.0] — 2026-08-01

### Phase 1 — Foundation Layer

Initial release: a lightweight, extensible, globally installed AI coding
assistant CLI.

#### Added

- Providers: OpenAI, Anthropic, Gemini, OpenRouter, plus an offline `mock`
  provider for demos/tests; streaming chat (`coder chat`, `coder ask`).
- Model management (`coder models`, `coder model use/current`), provider
  selection (`coder provider list/use/current`), sessions
  (`~/.coder/sessions/session-NNN.json`), config (`~/.coder/config.json`),
  themes, rotating pino logs, SQLite-backed model cache with offline
  fallback catalogues.
- Ink TUI for interactive chat with a readline REPL fallback; stable exit
  codes; `CODER_HOME`/`CODER_DEBUG`/`CODER_MODEL` env overrides.
