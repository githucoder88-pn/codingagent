# Architecture & Refactoring Notes (Phases 4–11)

This document describes how the Phase 4–11 layers are organized and the
extension points they introduce, layered on the Phase 1–3 foundation without
breaking backward compatibility.

## New module layout

```
src/
  runtime/        modes.ts (ExecutionMode incl. offline), store.ts (JsonStore),
                  run.ts (offline-aware dispatcher), status.ts, cluster.ts
  orchestration/  roles.ts (AGENT_ROLES), pipeline.ts, workflows.ts
  cognitive/      core.ts (CognitiveCore + engines), loops.ts (evolve, research)
  organizations/  manager.ts (orgs + cloud workspaces)
  knowledge/      graph.ts (global knowledge graph)
  civilization/   directors.ts, run.ts
  offline/        outbox.ts, recovery.ts, connect.ts (key mode 3)
  pet/            daemon.ts (persistent pet daemon)
  tasks/          queue.ts (persisted task queue)
  mcp/            manager.ts
  extensions/     manager.ts
  skills/         manager.ts
  session/memory/ scoped.ts (scoped memory hierarchy)
  providers/      openai-compatible.provider.ts, router.ts (ModelRouter)
```

Each new store is a JSON document under `~/.coder` accessed through the generic
`JsonStore` (`src/runtime/store.ts`), which reuses the atomic `readJson`/`writeJson`
helpers — the same persistence pattern as Phase 1–3.

## Extension points (unchanged contracts)

- **Provider interface** — new OpenAI-compatible providers are registered by
  instantiating `OpenAiCompatibleProvider` with an id/name/baseUrl. Azure
  extends it with `x-api-key` + `api-version`.
- **Agent roles** — add an entry to `AGENT_ROLES`; it immediately becomes
  available to orchestration, workflows, directors and the cognitive loop.
- **Directors** — add to `DIRECTORS` with a backing role + keyword layer.
- **Commands** — `(ctx, opts) => Promise<number>` handlers wired in
  `src/commands/index.ts` via the existing `wrap()` closure.

## Backward compatibility

Every Phase 1–3 command, flag and exit code is preserved. The global
`--version`/`-v` still prints the version; `--debug` is unchanged. New global
flags (`--offline`, `--pet`, `--autonomous`) are additive. Unknown commands still
exit `2`. The `mock` provider's tool-scripting (`CODER TOOLS`) and role markers
(`CODER AGENT ROLE:`) are intact, keeping offline tests deterministic.

## Versioning (single source of truth)

`VERSION` and `PHASE` live in `src/core/constants/index.ts`. `package.json`,
the e2e version assertion (`tests/e2e/cli.test.ts`), `scripts/smoke.mjs`, and
the **backend health endpoint** (`backend/src/server.ts` → reads `VERSION` from
core constants, never a hardcoded string) all derive from it.

## Build

Unchanged tsup config: three bundles (`dist/cli.js`, `dist/index.js`,
`dist/server.js`), web SPA via `publicDir: "web"`, runtime deps external.
`node:sqlite` is still loaded via dynamic import so the bundler leaves the
specifier intact. `.github/workflows/ci.yml` remains gitignored.
