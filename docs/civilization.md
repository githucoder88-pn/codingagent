# Autonomous Engineering Civilization (Phase 9)

A **civilization** is an Executive Director plus department Directors, each
mapping onto a real agent role. Defined in `src/civilization/directors.ts`.

## Directors

| Director | Layer | Backing role | Engaged by keywords |
| --- | --- | --- | --- |
| Executive Director | executive | coordinator | strategy, goal, plan |
| Chief Architect | architecture | architect | design, system, structure |
| Director of Research | research | researcher | investigate, survey |
| Director of Engineering | engineering | developer | build, implement, fix |
| Director of Security | security | security | security, auth, secret, cve |
| Director of Infrastructure | infrastructure | deployment | deploy, kubernetes, ci, scale |
| Director of Documentation | documentation | documenter | document, readme, guide |
| Director of Quality | quality | tester | test, coverage, bug, flaky |

## Commands

```console
coder civilization run <goal>      # strategic plan → allocate → execute → evaluate → reflect → knowledge update
coder civilization status          # list directors
coder civ <goal>                   # alias for civilization run
coder director <name> <task>       # dispatch to one director (aliases: architect, research, security, infra, docs, quality, engineering, executive)
```

## Keyword allocation

`allocateDirectors(goal)` always includes the Executive Director and (for build
goals) Engineering + Quality, then summons any director whose keyword layer
matches the goal — a security goal engages the Security Director, a deploy goal
engages Infrastructure.

## Global controller

`coder cluster status` reports the Gateway → controller → regional clusters →
worker nodes topology; `coder worker --region <name> --once` registers and runs.
Organization mode (`coder run --mode organization`) runs the enterprise pipeline
with shared global memory + knowledge-graph sync.
