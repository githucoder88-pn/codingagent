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
  ["coder auth <provider>", "Store an API key (openai | anthropic | gemini | openrouter)"],
  ["coder models", "List models for the active provider"],
  ["coder model use <model>", "Select the active model"],
  ["coder model current", "Show the active model"],
  ["coder provider list", "List providers"],
  ["coder provider use <provider>", "Select the active provider"],
  ["coder provider current", "Show the active provider"],
  ["coder sessions", "List / inspect / remove saved sessions"],
  ["coder clear", "Reset the current session's messages"],
  ["coder config show", "Inspect configuration"],
  ["coder help", "Show this help"],
] as const;

const EXAMPLES = [
  "coder auth openrouter",
  "coder models",
  "coder model use anthropic/claude-sonnet-4",
  'coder ask "Build a Todo application."',
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
