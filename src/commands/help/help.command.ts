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
  ["coder chat", "Start an interactive chat session"],
  ["coder ask <prompt…>", "One-shot prompt (continues the current session)"],
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
] as const;

const EXAMPLES = [
  "coder login",
  "coder auth add openrouter",
  "coder settings privacy on",
  'coder ask "Build a Todo application."',
  "coder feedback 5 \"Worked well\"",
  "coder dashboard",
  "coder model use anthropic/claude-sonnet-4",
  "coder chat",
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
