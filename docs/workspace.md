# CODER — Workspace Intelligence & Tool Execution (Phase 3)

Phase 3 turns CODER from a chat system into an autonomous coding
environment: it understands repositories, indexes symbols and
dependencies, searches semantically, edits files, runs commands, generates
patches, creates checkpoints, analyzes git history and repairs code — all
gated by a permission engine.

## Commands

```
coder scan [--dir <path>] [--refresh] [--json]
coder search <query> [--kind content|symbol|file|definition|references|dependencies|git]
coder files [--pattern <p>] [--all]
coder context [--json]
coder explain <file> [--symbol <name>] [--ai]
coder diff [--staged] [--json]
coder undo | redo [--dir <path>]
coder checkpoints [create|restore <id>|delete <id>] [--name <n>] [--dir <path>]
coder tools
coder agent <task> [--level safe|balanced|full-auto] [--dir <path>]
coder chat --safe | --balanced | --full-auto
```

## Repository intelligence

- **Scanning** (`coder scan`) — walks the repository respecting
  `.gitignore` (a built-in matcher handles `*`, `**`, `?`, negation),
  classifies files by language and role (source / test / documentation),
  detects the primary language, and reports: directories, source files,
  functions, classes, interfaces, imports, tests, lines of code.
- **Parsers** — four layers:
  1. **Babel** (`@babel/parser` + `@babel/traverse`) for `.js/.jsx`
     (handles JSX, Flow and experimental syntax; dialect auto-detected via
     the `@flow` pragma).
  2. **TypeScript compiler API** for `.ts/.tsx` (functions, classes,
     interfaces, enums, types, methods, imports, exports with line/column
     and doc comments).
  3. **Tree-sitter (WASM)** via `web-tree-sitter` + `tree-sitter-wasms`
     for Python, Go, Rust, Java, C, C++, C#, PHP — no native compilation.
  4. **Regex fallback** for anything else, so the indexer always produces
     symbols.
- **Indexing** (`src/workspace/indexer`) — parses every source file into a
  `RepoIndex` (files with hashes, symbols, imports/exports, test markers,
  dependency edges) cached at `~/.coder/cache/workspace/<repo-hash>.json`;
  reused when file hashes are unchanged.
- **Dependency graph** (`src/workspace/dependency`) — imports / imported-by,
  transitive closure, package dependencies, cycles, fan-in ("core files").
- **Semantic search** (`src/workspace/search`) — `find_symbol`,
  `find_definition`, `find_reference`, `find_imports`, `find_exports`,
  `find_related_code`, `find_tests`, content (grep) search, file search,
  git-history search (`git log -S`).
- **Embeddings** (`src/workspace/embeddings`) — deterministic local
  feature-hashed n-gram vectors (256-dim, L2-normalized, cosine
  similarity), stored per repository; an OpenAI-compatible remote provider
  hook exists for when network access is available. Powers related-file
  discovery and semantic file search.
- **Context engine** (`src/workspace/context`) — bundles structure, stats,
  git state (branch, last commit, changed files), dependency summary,
  related files, previous tool edits (from the execution ledger) and
  README documentation — the payload fed to the agent. Output is bounded
  (truncated docs, capped lists) for context compression.

## Tools

All tools are registered in `src/tools/registry.ts` (`coder tools`):

| Group | Tools | Minimum level |
| --- | --- | --- |
| Workspace | `scan`, `files`, `context` | safe |
| Filesystem | `read_file`, `list_directory` | safe |
| Filesystem | `write_file`, `append_file`, `replace_text`, `delete_file`, `rename_file`, `move_file`, `copy_file`, `create_directory` | balanced |
| Search | `search_files`, `search_content`, `search_symbols`, `search_dependencies`, `search_git_history`, `find_definition`, `find_references`, `find_tests`, `find_related` | safe |
| Git | `git_status`, `git_diff`, `git_log`, `git_branch` | safe |
| Git | `git_commit`, `git_checkout`, `git_restore` | balanced |
| Patch | `create_patch`, `validate_patch` | safe |
| Patch | `apply_patch` | balanced |
| Memory | `memory_note`, `memory_recall` | safe |
| Validation | `validate_file` | safe |
| Shell | `execute_command`, `run_tests`, `run_build`, `install_package`, `execute_script` | full-auto |

## Permission engine

`--safe` (read-only), `--balanced` (writes + patches + git mutations),
`--full-auto` (everything, including shell execution). Interactive prompts
offer one-time approvals when a tool exceeds the current level; in
non-interactive mode the call is denied with a clear reason.

The sandbox deny-list blocks destructive commands at any level:
recursive root deletions, `mkfs`, raw device writes, fork bombs, force
pushes, `git reset --hard`, `git clean -f`, pipe-to-shell, shutdown.

## Patches, diffs and rollback

- `computeDiff` / `applyUnifiedPatch` use jsdiff (unified diffs with
  fuzz); `apply_patch` validates before applying.
- Every mutating tool call snapshots the affected files **before** the
  mutation; `coder undo` restores (deleting files that did not exist
  before), `coder redo` re-applies. The execution ledger persists across
  invocations (`~/.coder/cache/workspace/execution-<repo>.json`).
- `coder diff` shows git diffs (when in a repo) or the recorded tool-edit
  diffs.

## Checkpoints

`coder checkpoints create` snapshots every indexed file into
`~/.coder/checkpoints/<repo-hash>/<name>-<ts>/`; `restore` copies them
back, `delete` removes, plain `coder checkpoints` lists. Checkpoint
records sync to the backend when signed in.

## Agent loop

`coder agent "<task>"` (or `coder chat --safe/--balanced/--full-auto`):
builds the repository context, calls the model with a tool-use protocol
(the model replies with a fenced `{"tool": ..., "params": ...}` JSON block
to act, or plain text to finish), executes tool calls through the
permission-gated scheduler, feeds results back, and iterates (max 15
steps). The offline `mock` provider walks a scripted sequence (scan →
files → git_status → write_file → run_tests → git_commit → summary), so
the whole flow is testable without network access.

## Backend sync

When signed in, `coder scan` uploads the repository index (summary +
files + embeddings) to the control plane; search queries are logged to
`search_history`, checkpoints and agent-generated patches to their tables.
The web dashboard shows Workspace (user) and Repositories (admin) views;
admins get repository analytics via `GET /api/admin/workspace`, including
storage totals, failure reports (agent runs with failed tool calls) and
performance metrics (average/max agent duration, 7-day prompt volume).
