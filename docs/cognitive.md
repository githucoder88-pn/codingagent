# Cognitive Engineering & Adaptive Intelligence (Phase 5 / 7)

CODER has a **cognitive core** (`src/cognitive/core.ts`) that wires cooperating
engines together and persists its state at `~/.coder/cognitive/state.json`.

## Engines

planning · reasoning · reflection · learning · world-model · memory ·
evaluation · adaptation · prediction · optimization

- **adapt(outcome)** — success *lowers* the `riskThreshold`; failure *raises* it
  (bounded 0.1–0.9).
- **reflect** — records outcome markers (`success`/`failure`) + lessons.
- **predict(task)** — confidence from historical win-rate + keyword lessons.
- **updateWorldModel** — entity counts from the scanned workspace index.
- **optimize** — suggests per-role weight tuning from history.

## Self-improvement loop

`coder evolve <task>` runs: **observe → measure → analyze → plan → execute →
reflect → learn**. Adaptation lowers `riskThreshold` and adjusts step weights.

```console
coder evolve "add a login form and tests"
coder cognitive status
```

## Autonomous research

`coder research <topic>` surveys the repository (symbols, content, git history)
and synthesises a report via the model.

## Memory hierarchy

Scoped memory (`coder memory store|recall|search --scope`) maps onto canonical
stores:

| Alias | Scope |
| --- | --- |
| immediate | session |
| working | project (keyed `repo:<abs>`) |
| long-term | user |
| global | global |

Episodic / semantic / procedural are knowledge **kinds** recorded against the
long-term and global stores.

## Distributed execution

`coder worker --once` claims and runs the next queued task; the cluster topology
is Gateway → controller → regional clusters → worker nodes
(`coder cluster status`). See `docs/civilization.md` for the agent civilization.
