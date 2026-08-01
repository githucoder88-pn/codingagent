# CODER — Security model (Phase 2)

Phase 2 treats secrets as sensitive by default. This document describes how
the CLI and the backend handle encryption, hashing, authentication, privacy
and training data.

## Threat model

- The database must not contain plaintext provider API keys.
- The database must not contain plaintext passwords (only scrypt hashes).
- A leaked database must not reveal usable keys or passwords.
- A leaked master key must be recoverable from by rotation.
- Users control their own data (history, training, deletion, export).

## Encryption

### Provider API keys

Keys are encrypted with **AES-256-GCM** before storage:

```
envelope := "<version>.<iv>.<authTag>.<ciphertext>"   (base64url)
```

- CLI vault: `~/.coder/vault.json` (whole-file envelope). Master key at
  `~/.coder/keys/master.key` (0600, auto-generated).
- Backend: `provider_keys.encrypted_key` (per-key envelope). Master key at
  `~/.coder/server/keys.json` (0600) or `CODER_MASTER_KEY`.

Decryption happens only when needed and the plaintext is discarded
immediately (see the server-side proxy in `backend/src/providers/proxy.ts`:
decrypt → call provider → drop).

### Key rotation

Envelopes are versioned, so rotation archives the previous key while active
rows are re-encrypted:

```console
coder admin rotate-key --yes        # superadmin only
```

- Generates a new active key (`v2`, `v3`, …), archives the old one in
  `keys.json`, re-encrypts every stored provider key.
- Old envelopes continue to decrypt via the archived key.
- Rotation is disabled while `CODER_MASTER_KEY` is set via the environment
  (the env key cannot be archived).

## Hashing

| What | How | Where |
| --- | --- | --- |
| Passwords | scrypt (N=16384, r=8, p=1) + per-user salt, format `scrypt$N$r$p$salt$hash` | `users.hashed_password` |
| Key fingerprints | sha256 hex (stored; first 16 chars shown) | `provider_keys.key_hash` |
| JWT signature | HMAC-SHA256 | API tokens |

Password verification uses constant-time comparison.

## Authentication

- **Email/password** — scrypt-hashed; login issues an HS256 JWT with a
  server-side session (`api_sessions`, revocable via `logout`).
- **Firebase Auth (optional)** — `CODER_FIREBASE_PROJECT_ID` enables
  `POST /api/auth/firebase`; ID tokens are verified against Google's JWKS
  (RS256, aud/iss/exp checks, cached JWKS). Firebase handles identity; the
  CODER database still owns prompts, responses, feedback and analytics.
- **Sessions** — 7-day TTL (configurable), revoked on logout and on
  account deletion.
- **Admin separation** — `role: user | admin | superadmin`. Admin
  endpoints return 403 for non-admins; key rotation additionally requires
  `superadmin`.

## Privacy controls

| Setting | Effect |
| --- | --- |
| `coder settings privacy on` | Maximum privacy: history recording off, training off |
| `coder settings history on\|off` | Record prompts & responses (local + backend) |
| `coder settings training on\|off` | Opt in/out of training data — **always explicit, revocable** |
| `coder export` | Download a full data bundle |
| `coder delete-account` | Erase the account and all backend data (cascade) |

Enforcement points:

- When history is disabled the backend **refuses** to store prompts
  (`recorded:false, reason:"history_disabled"`) — the CLI also skips
  recording locally, so nothing leaves the machine.
- Training rows are only marked `for_training` when the user opted in
  **before** the record was created; opt-out does not retroactively mark.
- Feedback is always accepted (feedback-only mode stores the rating without
  the prompt text).

## Audit logs

Security-relevant actions are recorded in `audit_logs` (they deliberately
outlive account deletion):

`auth.signup`, `auth.login`, `auth.logout`, `key.add`, `key.remove`,
`settings.update`, `feedback.add`, `export.requested`, `account.deleted`,
`admin.rotate-key`, `admin.training.dataset`, `admin.seeded`.

## Admin data access rules

- Admins can inspect users, prompts, feedback, audit logs and usage.
- The training dataset endpoint (`/admin/training/dataset`) returns only
  records from users who opted in.
- Admins cannot read plaintext provider keys — only fingerprints.
- Rotation is the only security-sensitive admin mutation and requires
  `superadmin`.

## Operational notes

- `~/.coder/session.json`, `~/.coder/vault.json`, `~/.coder/settings.json`,
  `~/.coder/records.json`, `~/.coder/server/*` are written with 0600
  permissions.
- `~/.coder/server/` holds the SQLite DB, master key, JWT secret, and
  server log — keep it out of backups that leave the machine, or encrypt
  them.
- The backend binds `127.0.0.1` by default; use `CODER_API_HOST=0.0.0.0`
  only on trusted networks (there is no TLS — put a reverse proxy in front
  for remote access).
