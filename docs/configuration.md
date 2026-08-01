# Configuration

## The CODER home directory

All state lives in `~/.coder` (relocatable with `CODER_HOME`):

```
~/.coder/
├── config.json            # user settings (zod-validated)
├── providers.json         # API keys / base URL overrides (0600)
├── sessions/              # one JSON file per conversation
│   ├── current.json       # pointer to the active session
│   └── session-001.json
├── logs/                  # pino JSON logs (rotated at 5 MB)
│   ├── debug.log
│   ├── error.log
│   └── latest.log
└── cache/
    └── coder.db           # SQLite: metadata + model catalogue cache
```

## config.json

```json
{
  "provider": "openrouter",
  "model": "anthropic/claude-opus-4",
  "theme": "default",
  "stream": true
}
```

| Key | Values | Default | Meaning |
| --- | --- | --- | --- |
| `provider` | `openai` \| `anthropic` \| `gemini` \| `openrouter` \| `mock` | `openrouter` | Active provider |
| `model` | any model id, or `null` | `null` | Active model (`null` = provider default) |
| `theme` | `default` \| `dark` \| `light` \| `none` | `default` | UI colour theme |
| `stream` | `true` \| `false` | `true` | Stream responses by default |

Edit via commands:

```console
coder config show
coder config get model
coder config set provider anthropic
coder config set model claude-sonnet-4
coder config set theme dark
coder config set stream false
coder config path
```

`config set model ""` clears the model (back to the provider default).
Unknown keys and invalid values are rejected with a clear message.

## Environment variables

Environment overrides beat `config.json` (the file is never modified):

| Variable | Effect |
| --- | --- |
| `CODER_HOME` | Relocate `~/.coder` (tests, portable installs) |
| `CODER_PROVIDER` | Override the active provider |
| `CODER_MODEL` | Override the active model |
| `CODER_THEME` | Override the theme |
| `CODER_STREAM` | `0`/`false` disables streaming |
| `CODER_DEBUG` | `1`/`true` enables verbose console + debug logging |
| `NO_COLOR` | Disable ANSI colours (standard) |

## Sessions

A session file:

```json
{
  "id": "session-001",
  "createdAt": "2026-08-01T12:00:00.000Z",
  "updatedAt": "2026-08-01T12:05:00.000Z",
  "provider": "openrouter",
  "model": "anthropic/claude-sonnet-4",
  "messages": [
    { "role": "user", "content": "Build a Todo application." },
    { "role": "assistant", "content": "…" }
  ]
}
```

- Every `ask` / `chat` turn is persisted immediately (atomic write).
- `coder ask` calls continue the current session unless `--session <id>` is
  given.
- Sessions are validated on load; corrupt files raise a clear error instead
  of crashing.
- Long conversations are trimmed to the model's context window
  (approximate, oldest turns first; the system prompt and recent messages
  survive).

## Logging

`~/.coder/logs` contains pino JSON lines:

- `debug.log` — everything (level trace+)
- `error.log` — errors only
- `latest.log` — the most recent invocation (truncated on each run)

Files rotate once they exceed 5 MB (`.1` backup kept). The console stays
clean by default — only warnings/errors print; use `CODER_DEBUG=1` (or
`--debug`) for verbose console output.
