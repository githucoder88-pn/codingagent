# Enterprise Cloud Runtime & Adaptive Organization (Phase 6 / 8)

## Organizations (Phase 6)

Multi-tenant grouping with role-bearing members, shared memory and cloud
workspaces. The backend mirrors these as SQLite tables (`organizations`,
`organization_members`, `usage_metrics`, `shared_memory`, `cloud_workspaces`);
the CLI keeps an offline-first copy at `~/.coder/organizations/orgs.json`.

```console
coder org create Acme --plan business
coder org list
coder org show Acme
coder org member add Acme b@x --role admin
coder org usage Acme
coder org memory store Acme --key style --value tabs
```

Roles: `owner` · `admin` · `member`.

## Cloud workspaces

```console
coder workspace create dev                              # local → running
coder workspace create prod --environment kubernetes    # cloud → creating
coder workspace list
coder workspace start|stop|destroy <id>
```

Environments: `local`, `hybrid`, `dedicated-cloud`, `kubernetes`, `container`,
`serverless`. Local/container workspaces come up immediately; cloud environments
start in `creating`.

`coder runtime` shows cluster + organization + workspace counts.

## Global knowledge network (Phase 8)

`coder knowledge graph|stats|search` builds and queries a knowledge graph
(entity hierarchy Framework → Repository → Class → Method → Dependency, plus
languages, APIs, goals, lessons) at `~/.coder/cache/knowledge/graph.json`.
Re-observing an entity **bumps its weight**; search ranks by weight × relevance.

## Model intelligence (Phase 8)

```console
coder model benchmark [--provider p] [--model m] [--all] [--json]
coder model info <model-id>          # classify (chat/code/embedding/reasoning) + cost
```

A `ModelRouter` (`src/providers/router.ts`) classifies models, estimates cost
from per-family rates, and routes to the cheapest capable model. **13+ providers**
are registered (openai, anthropic, gemini, openrouter, groq, deepseek, cohere,
together, xai, azure, bedrock, litellm, ollama + offline mock). Azure uses
`x-api-key` + `?api-version=`; ollama is keyless at `http://localhost:11434/v1`.
