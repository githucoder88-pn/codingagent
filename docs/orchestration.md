# Multi-Agent Orchestration (Phase 4)

CODER orchestrates named **agent roles** into deterministic pipelines. With the
offline `mock` provider every step is fully testable without a network.

## Agent roles

Defined in `src/orchestration/roles.ts` (`AGENT_ROLES`). Each role carries a
system prompt, a permitted **tool subset**, and a permission level.

| Role | Responsibility | Level |
| --- | --- | --- |
| planner | Decompose goals into ordered, verifiable steps | safe |
| researcher | Survey codebase + prior art | safe |
| developer | Implement the change | balanced |
| reviewer | Audit correctness, style, regressions | safe |
| tester | Design + run tests; report coverage gaps | full-auto |
| security | Threat-model; flag risks | safe |
| documenter | Record the change in docs | balanced |
| memory | Persist facts + lessons | safe |

List them with `coder roles`.

## Commands

```console
coder plan <task>                  # planner only
coder orchestrate <task>           # plan → research → implement → test → review → document → report
coder agent <task>                 # autonomous single-agent loop (Phase 3)
coder workflow list|install|run    # reusable role pipelines
```

## Workflows

A workflow is a named, ordered sequence of role steps. Built-ins: `full-cycle`,
`bugfix`, `ship`. Install your own:

```console
coder workflow install mini --steps planner,developer
coder workflow run mini "add a settings page"
```

## Tasks, MCP, extensions, skills

- **Task queue** — `coder task run|list|status|cancel` (persisted at
  `~/.coder/tasks/queue.json`; statuses queued → running → succeeded|failed|cancelled).
- **MCP** — `coder mcp add|remove|enable|list|connect|disconnect|discover`.
  Discovery probes a server's tool surface (`tools/list` for http/sse; inferred
  for stdio) and tools execute through the scheduler.
- **Extensions** — `coder extension install|remove|update|enable|list` with an
  `extension.json` manifest.
- **Skills** — `coder skill list|use|show|install|create`. Built-in domains:
  react, python, devops, database, security, ui, testing, refactor.

## Determinism

The mock provider recognises a `CODER AGENT ROLE: <role>` marker in the system
prompt and returns a canned per-role completion, so any pipeline built from
these roles is deterministic offline.
