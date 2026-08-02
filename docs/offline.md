# Offline-First Runtime (Phase 11)

**Core philosophy: the backend is optional, the local runtime is mandatory.**

CODER runs completely with zero cloud. Every command works offline; the
backend control plane is an optional accelerator, never a hard dependency.

## Offline modes

- `coder --offline` — global flag that forces the whole process offline. Bare
  `coder --offline` (no command) opens the **runtime status panel**.
- `coder run <task> --mode offline` — run a task without touching the network.
- `coder run --mode cloud` with an **unreachable backend** falls back to local
  execution and **parks the task in the sync outbox** (graceful degradation).

## Sync engine

Tasks and records created while offline are parked in the **sync outbox**
(`~/.coder/cache/outbox.json`) and drained later:

```console
coder sync --flush      # drain the offline outbox when the cloud returns
```

The persistent **pet/daemon** flushes the outbox automatically when it detects
the backend is reachable again.

## Recovery

`coder recover` (and the continuous loop inside the pet/daemon) re-queues
**failed local tasks once**. A persisted `retried` marker prevents retry loops.

## Key management — Mode 3 (workspace connections)

`coder connect` records workspace connections locally. While offline they are
`pending`; they are validated (`GET /api/workspaces`) when the backend returns.

```console
coder connect workspace <id>     # record (pending while offline)
coder connect list               # show connection status
coder connect remove <id>
```

## Persistent pet daemon

```console
coder daemon start [--dir] [--autonomous]   # detached spawn of `coder pet`
coder daemon status                          # pid / workspace / log tail
coder daemon stop                            # SIGTERM → wait → SIGKILL fallback
coder pet [--autonomous]                     # foreground pet
coder --pet | coder --autonomous             # global shortcuts
```

State: `~/.coder/cache/daemon.json` · Log: `~/.coder/logs/daemon.log`.
In autonomous mode the pet runs a **recovery pass + background sync** then idles
with the message `Awaiting instructions.`

## Status panel

```console
coder status [--json]
```

Aggregates: Mode · Backend (health probe with version) · Session · Memory ·
Pet (daemon) · Sync outbox · queued/failed tasks · connected workspaces. Every
probe is best-effort and non-blocking.

## Session restoration

```console
coder restore [id]     # make the last (or given) session current again
```

## Checkpoint alias

```console
coder checkpoint create|list|restore|delete   # alias of `coder checkpoints`
```

## Storage layout (`~/.coder`)

| Path | Contents |
| --- | --- |
| `config.json` | CLI settings (provider, model, theme, stream) |
| `cache/` | caches, `cache/outbox.json` (sync outbox), `cache/knowledge/graph.json`, `cache/daemon.json`, `cache/recovery.json`, `cache/cluster/state.json` |
| `memory/` | scoped memory: `session.json`, `project.json`, `user.json`, `global.json` |
| `sessions/` | conversation sessions + `current.json` pointer |
| `providers.json` | legacy provider store (migrated into the vault) |
| `keys/` | encrypted key material |
| `checkpoints/` | workspace checkpoint snapshots |
| `logs/` | rotating logs + `daemon.log` |
| `embeddings/` | local embedding vectors |
| `skills/` | skill library (`skills.json`) |
| `extensions/` | installed extensions (`extensions.json`) |
| `repositories/` | tracked repository mirrors |
| `vault.json`, `session.json`, `settings.json`, `records.json` | account & data plane |

Override the whole tree with `CODER_HOME=<dir>` (used by tests and portable
installs).

`ExecutionMode` includes `offline` (see `src/runtime/modes.ts`).
