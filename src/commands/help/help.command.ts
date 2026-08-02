/**
 * CODER — `coder help`.
 *
 * Extended help: banner, command overview and examples. Commander also
 * provides `--help` per command; this one is the friendly entry point.
 */

import { APP_DISPLAY_NAME, PHASE, VERSION } from "../../core/constants/index.js";
import { type Theme } from "../../ui/themes/theme.js";
import { renderBanner, renderTable } from "../../ui/components/primitives.js";
import { paths } from "../../utils/paths.js";

const COMMANDS = [
  ["coder chat [--safe|--balanced|--full-auto]", "Interactive chat (agent mode with a permission level)"],
  ["coder ask <prompt…>", "One-shot prompt (continues the current session)"],
  ["coder agent <task>", "Autonomous agent run (tools + model)"],
  ["coder scan", "Scan + index the repository"],
  ["coder search <q> [--kind …]", "Search content / symbols / files / deps / git"],
  ["coder files", "List repository files"],
  ["coder context", "Repository context bundle"],
  ["coder explain <file>", "Explain a file (symbols, relations, tests)"],
  ["coder diff | undo | redo", "Workspace changes + rollback"],
  ["coder checkpoints [create|restore|delete]", "Workspace checkpoints"],
  ["coder tools", "List workspace tools + permission levels"],
  ["coder login | signup | logout", "Account management"],
  ["coder auth add <provider>", "Store an API key (encrypted, synced)"],
  ["coder auth list | status | remove", "Inspect / remove keys"],
  ["coder models", "List models for the active provider"],
  ["coder model use <model>", "Select the active model"],
  ["coder model current", "Show the active model"],
  ["coder provider list | use | current", "Provider selection"],
  ["coder settings", "Settings + privacy (history, training)"],
  ["coder privacy", "Privacy controls"],
  ["coder feedback <1-5> [comment]", "Rate the last response"],
  ["coder history [--remote]", "Prompt/response history"],
  ["coder sync", "Push records + keys to the backend"],
  ["coder export", "Export your data as JSON"],
  ["coder dashboard", "Open the web dashboard"],
  ["coder server start | status | stop", "Backend lifecycle"],
  ["coder admin <users|prompts|feedback|logs|training|usage|models>", "Admin management"],
  ["coder sessions", "List / inspect / remove saved sessions"],
  ["coder clear", "Reset the current session's messages"],
  ["coder config show", "Inspect configuration"],
  ["coder delete-account", "Permanently delete your account"],
  ["coder help", "Show this help"],
  // Phase 4 — orchestration, MCP, extensions, skills, tasks, workflows
  ["coder roles", "List the available agent roles"],
  ["coder plan | orchestrate <task>", "Plan / run a multi-agent pipeline"],
  ["coder workflow list | install | run", "Reusable role pipelines"],
  ["coder mcp add | list | discover | connect", "MCP servers + tools"],
  ["coder extension install | list | update", "Extensions"],
  ["coder skill list | use | create", "Domain skills"],
  ["coder task run | list | status | cancel", "Persisted task queue"],
  // Phase 5/7 — cognitive
  ["coder cognitive status", "Cognitive core state"],
  ["coder evolve <task>", "Adaptive self-improvement loop"],
  ["coder research <topic>", "Autonomous research engine"],
  // Phase 5/7/9 — memory
  ["coder memory store | recall | search --scope", "Scoped memory (session/project/user/global)"],
  // Phase 8 — knowledge + models
  ["coder knowledge graph | stats | search", "Global knowledge graph"],
  ["coder model benchmark | info", "Model benchmark / classification + cost"],
  // Phase 6 — enterprise
  ["coder org create | list | member | usage | memory", "Organizations"],
  ["coder workspace create | list | start | stop | destroy", "Cloud workspaces"],
  ["coder runtime", "Runtime monitoring"],
  // Phase 9 — civilization + distributed
  ["coder civilization run | status", "Engineering civilization (alias: civ)"],
  ["coder director <name> <task>", "Dispatch to a single director"],
  ["coder cluster status | worker --once", "Distributed cluster + workers"],
  // Phase 11 — offline-first
  ["coder run <task> --mode local|hybrid|cloud|agent|enterprise|organization|offline", "Runtime task dispatcher"],
  ["coder --offline", "Force offline (bare: open the status panel)"],
  ["coder pet [--autonomous] | daemon start | status | stop", "Persistent pet + daemon"],
  ["coder status [--json]", "Runtime status panel"],
  ["coder connect workspace <id> | list | remove", "Workspace connections (key mode 3)"],
  ["coder sync --flush | recover", "Drain the offline outbox / recover tasks"],
  ["coder restore [id]", "Restore a session"],
  ["coder checkpoint create | list | restore | delete", "Checkpoint alias"],
] as const;

const EXAMPLES = [
  "coder scan",
  "coder search authentication",
  "coder explain src/index.ts",
  "coder agent \"Fix all TypeScript errors.\" --level balanced",
  "coder chat --full-auto",
  "coder checkpoints create --name before-refactor",
  "coder login",
  "coder auth add openrouter",
  "coder settings privacy on",
  'coder ask "Build a Todo application."',
  "coder feedback 5 \"Worked well\"",
  "coder dashboard",
] as const;

export function renderHelp(theme: Theme): string {
  const configLabel = process.env.CODER_HOME ? paths.root() : "~/.coder";
  const banner = renderBanner(
    APP_DISPLAY_NAME,
    [
      { label: "Version", value: `v${VERSION}` },
      { label: "Phase", value: PHASE },
      { label: "Config", value: configLabel },
    ],
    theme,
  );
  const commandTable = renderTable(
    ["COMMAND", "DESCRIPTION"],
    COMMANDS.map(([cmd, desc]) => [cmd, desc]),
    { indent: "  " },
  );
  return [
    banner,
    "",
    `${theme.bold}Usage${theme.reset}: coder <command> [options]`,
    "",
    `${theme.bold}Commands${theme.reset}:`,
    commandTable,
    "",
    `${theme.bold}Examples${theme.reset}:`,
    ...EXAMPLES.map((e) => `  ${theme.dim}$ ${e}${theme.reset}`),
    "",
    `${theme.dim}Run \`coder <command> --help\` for command-specific options.${theme.reset}`,
  ].join("\n");
}
