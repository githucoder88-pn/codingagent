# Changelog

All notable changes to CODER are documented here.

## [7.0.0] — 2026-08-01

### Phases 4–11 — Full Platform Reconstruction → Offline-First Runtime

CODER grows from a workspace tool into an open, extensible, provider-independent
AI engineering platform that works with **zero cloud**.

#### Phase 4 — Multi-Agent Orchestration, MCP, Extensions, Skills, Tasks, Workflows
- **Agent roles** (`src/orchestration/roles.ts`): planner, researcher, developer,
  reviewer, tester, security, documenter, memory — each with a system prompt,
  tool subset and permission level. `coder roles`, `coder plan`, `coder orchestrate`.
- **Orchestration pipeline** (plan → research → implement → test → review →
  document → report) and reusable **workflows** (`coder workflow list|install|run`).
- **MCP** servers (`coder mcp add|remove|enable|list|connect|disconnect|discover`)
  with discovery + tool execution through the scheduler.
- **Extensions** (`extension.json`), **skills** (react, python, devops, database,
  security, ui, testing, refactor), and a persisted **task queue**
  (`~/.coder/tasks/queue.json`; queued → running → succeeded|failed|cancelled).

#### Phase 5 / 7 — Cognitive Core & Adaptive Intelligence
- **CognitiveCore** (`src/cognitive/`): planning, reasoning, reflection, learning,
  world-model, memory, evaluation, adaptation, prediction, optimization engines.
- `coder evolve <task>` (observe → … → learn; adaptation lowers riskThreshold),
  `coder research <topic>`, `coder cognitive status`.
- **Scoped memory** hierarchy (immediate→session, working→project, long-term→user,
  global) with episodic/semantic/procedural kinds; `coder memory store|recall|search`.
- Distributed execution: `coder worker --once`, `coder cluster status`.

#### Phase 6 — Enterprise Cloud Runtime
- **Organizations** (`coder org create|list|show|member|usage|memory`), cloud
  **workspaces** (`coder workspace create|list|start|stop|destroy`), `coder runtime`.
- Backend tables: `organizations`, `organization_members`, `usage_metrics`,
  `shared_memory`, `cloud_workspaces`.

#### Phase 8 — Global Knowledge Network & Model Intelligence
- **Knowledge graph** (`coder knowledge graph|stats|search`; entity hierarchy,
  weight-bumped reinforcement, ranked search) at `~/.coder/cache/knowledge/graph.json`.
- **ModelRouter** + `coder model benchmark|info` (classification, cost estimation,
  cost-optimized routing). **14 providers** registered (added groq, deepseek,
  cohere, together, xai, azure, bedrock, litellm, ollama).

#### Phase 9 — Autonomous Engineering Civilization
- **Civilization** (Executive + Architecture/Research/Engineering/Security/
  Infrastructure/Documentation/Quality directors), keyword-based allocation.
  `coder civilization run|status` (alias `civ`), `coder director <name> <task>`.

#### Phase 11 — Offline-First Runtime, Personal Mode, Persistent Pet Mode
- `coder --offline` global flag (bare → status panel), `coder run --mode offline`,
  and **graceful cloud degradation** (unreachable backend → local + sync outbox).
- **Sync outbox** + `coder sync --flush`; **recovery** (`coder recover`); key
  management Mode 3 (`coder connect workspace|list|remove`).
- Persistent **pet/daemon** (`coder daemon start|status|stop`, `coder pet`),
  `coder restore [id]`, `coder status [--json]`, `checkpoint` alias.
- `ExecutionMode` gains `offline`.

#### Tooling & docs
- 301 tests across unit / integration / e2e + phase suites; 10 smoke scripts
  (smoke + phase2…phase9 + phase11). Docs: orchestration, cognitive,
  enterprise-adaptive, civilization, refactoring, offline (+ README/CHANGELOG).
- Version bumped to 7.0.0; `VERSION`/`PHASE` in `src/core/constants`, the e2e
  version assertion, `scripts/smoke.mjs`, and the backend health endpoint all read
  the single source of truth.

## [0.3.0] — 2026-08-01

### Phase 3 — Workspace Intelligence & Tool Execution Platform

CODER becomes an autonomous coding environment: repository scanning,
symbol indexing, dependency analysis, semantic search, file editing, shell
execution, patch generation, checkpoints, git analysis and automatic
repair — gated by a permission engine.

#### Added

- **Workspace layer** (`src/workspace/`) — repository scanner (gitignore
  aware, language detection), symbol indexer (TypeScript compiler API +
  Tree-sitter WASM for Python/Go/Rust/Java/C/C++/C#/PHP + regex fallback),
  dependency graph (imports/imported-by, packages, cycles, core files),
  search engine (`find_symbol/definition/reference/imports/exports/
  related/tests`, content + git-history search), local embeddings
  (feature-hashed n-gram vectors with cosine similarity) and a context
  engine (structure, git state, docs, related files).
- **Commands** — `coder scan`, `coder search`, `coder files`,
  `coder context`, `coder explain <file> [--ai]`, `coder diff`,
  `coder undo` / `coder redo`, `coder checkpoints
  [create|restore|delete]`, `coder tools`, `coder agent <task>`.
- **Tools** (`src/tools/`) — filesystem (read/write/append/replace/
  delete/rename/copy/mkdir/list), search, shell (execute_command,
  run_tests, run_build, install_package, execute_script), git
  (status/diff/commit/branch/checkout/restore/log), patch (create/apply/
  validate), memory notes, validation.
- **Execution layer** (`src/execution/`) — permission engine
  (safe/balanced/full-auto with one-time approvals), execution scheduler
  with an undo/redo ledger persisted per workspace, rollback snapshots
  (taken before every mutation, including new-file deletion on undo),
  checkpoint engine, command sandbox deny-list, and the agent loop
  (context → model tool-call protocol → execute → iterate).
- **Chat agent mode** — `coder chat --safe | --balanced | --full-auto`
  routes ordinary messages through the agent; slash commands
  `/files /search /context /git /diff /undo /redo /checkpoints /explain`.
- **Backend** — `repositories`, `indexed_files`, `embeddings`,
  `checkpoints`, `patches` and `search_history` tables; workspace API
  (`/api/workspace/*`), admin repository analytics
  (`GET /api/admin/workspace`); dashboard Workspace (user) and
  Repositories (admin) tabs.
- **Sync** — `coder scan` uploads the repo index (files + embeddings),
  search queries log to history, checkpoints and agent patches sync —
  all offline-tolerant.
- **Offline mock agent** — the mock provider walks a scripted tool
  sequence (scan → files → git_status → write_file → run_tests →
  git_commit → summary) so the exit condition is testable without network.

#### Changed

- Version bumped to 0.3.0; `PHASE` = "Phase 3 — Workspace Intelligence &
  Tool Execution Platform".

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
