# CODER backend — API reference (Phase 2)

The control plane runs at `http://127.0.0.1:8747` by default
(`CODER_API_HOST` / `CODER_API_PORT`). All endpoints except `/api/health`,
`/api/auth/signup`, `/api/auth/login` and `/api/auth/firebase` require:

```
Authorization: Bearer <token>
```

Errors use a uniform envelope:

```json
{ "error": { "code": "unauthorized", "message": "Not signed in. Run `coder login`." } }
```

Exit-code mapping for the CLI: `2` usage · `3` auth · `4` network · `5`
provider · `6` config.

## Health

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | `{ ok, version }` |

## Auth

| Method | Path | Body | Description |
| --- | --- | --- | --- |
| POST | `/api/auth/signup` | `{email, password (≥8)}` | Create account → `{token, user}` |
| POST | `/api/auth/login` | `{email, password}` | Sign in → `{token, user}` |
| POST | `/api/auth/logout` | — | Revoke the current session |
| GET | `/api/auth/session` | — | Current user |
| POST | `/api/auth/firebase` | `{idToken}` | Firebase ID-token exchange (when configured) |
| POST | `/api/auth/provider-key` | `{provider, apiKey}` | Store a key (AES-256-GCM at rest) |
| GET | `/api/auth/provider-keys` | — | Fingerprints only, never plaintext |
| DELETE | `/api/auth/provider-key/:provider` | — | Remove a key |

## Users

| Method | Path | Body | Description |
| --- | --- | --- | --- |
| GET | `/api/users/me` | — | Profile + privacy settings |
| PATCH | `/api/users/me/settings` | `{historyEnabled?, trainingOptIn?}` | Update privacy settings |
| GET | `/api/users/me/stats` | — | Usage counts |

## Chat

| Method | Path | Body | Description |
| --- | --- | --- | --- |
| POST | `/api/chat/prompt` | `{clientRecordId?, sessionId, provider, model, prompt, response?, tokensUsed?, latencyMs?, forTraining?}` | Record a turn (idempotent via `clientRecordId`; refused when history is off) |
| GET | `/api/chat/history` | query: `limit, offset, sessionId` | Prompt/response/feedback history |
| POST | `/api/chat/feedback` | `{promptId?, rating (1-5), comment?}` | Attach feedback (promptId optional — feedback-only mode) |
| POST | `/api/chat/completions` | `{provider, model, messages, temperature?, maxTokens?}` | Server-side proxy: decrypts the stored key in memory, calls the provider, discards the key |

## Admin (role: admin / superadmin)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/admin/users?search&limit&offset` | Users with prompt counts |
| GET | `/api/admin/prompts?limit&offset` | Prompts across users |
| GET | `/api/admin/feedback?limit&offset` | Feedback + rating distribution |
| GET | `/api/admin/logs?limit&offset&action` | Audit logs |
| GET | `/api/admin/training` | Opt-in / dataset counts |
| GET | `/api/admin/training/dataset?limit&offset` | Training rows (opted-in users only) |
| GET | `/api/admin/usage?days` | Prompts/day, by provider, by model, latency, tokens |
| POST | `/api/admin/rotate-key` | Rotate master key + re-encrypt all keys (superadmin) |

## Data ownership

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/export` | Full data bundle (keys as fingerprints only) |
| POST | `/api/delete-account` | Cascade-delete the account and all data (audit trail survives) |

## Database

SQLite (`~/.coder/server/coder.db`, node:sqlite, WAL). Tables: `users`,
`api_sessions`, `provider_keys`, `prompts`, `responses`, `feedback`,
`audit_logs`, `training_consent`.

## Server administration

```console
coder server start [--port N] [--foreground]
coder server status [--port N]
coder server stop [--port N]
coder dashboard [--no-open]
```

Environment: `CODER_API_HOST`, `CODER_API_PORT`, `CODER_SERVER_DIR`,
`CODER_DB_PATH`, `CODER_MASTER_KEY`, `CODER_JWT_SECRET`,
`CODER_TOKEN_TTL_SEC`, `CODER_FIREBASE_PROJECT_ID`,
`CODER_ADMIN_EMAIL`, `CODER_ADMIN_PASSWORD`, `CODER_ADMIN_SUPERADMIN`.
