/**
 * CODER — `coder settings` and `coder privacy`.
 *
 * Settings show/manage both the classic CLI config (provider, model,
 * theme, stream) and the account privacy settings (history recording,
 * training opt-in), which are mirrored to the backend when signed in.
 */

import { loadSettings, saveSettings, setPrivacyProfile } from "../../account/settings.js";
import { loadSession } from "../../account/session-store.js";
import { pushSettingsToBackend } from "../account/login.command.js";
import { UsageError } from "../../core/errors/index.js";
import { renderTable } from "../../ui/components/primitives.js";
import type { AppContext } from "../../core/application/application.js";

const CONFIG_KEYS = ["provider", "model", "theme", "stream"] as const;

export async function settingsShowCommand(ctx: AppContext): Promise<number> {
  const { config, theme } = ctx;
  const settings = ctx.settings();
  const privacy = loadSettings();
  const session = loadSession();

  const lines: string[] = [
    `${theme.bold}CLI configuration (${config.path()})${theme.reset}`,
    ...CONFIG_KEYS.map((key) => `  ${key.padEnd(8)}: ${String(config.get(key))}`),
    "",
    `${theme.bold}Privacy settings (${session ? `account: ${session.user.email}` : "local only — not signed in"})${theme.reset}`,
    `  history : ${privacy.historyEnabled ? "on" : "off"}  (record prompts & responses)`,
    `  training: ${privacy.trainingOptIn ? "on (opted in)" : "off"}  (never collected without consent)`,
    "",
    `${theme.dim}Change with: coder settings set <key> <value> · coder settings privacy on|off · coder privacy history on|off${theme.reset}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

export async function settingsSetCommand(ctx: AppContext, key: string, value: string): Promise<number> {
  const { config, theme } = ctx;
  if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
    throw new UsageError(`Unknown setting "${key}". Valid keys: ${CONFIG_KEYS.join(", ")}.`);
  }
  const k = key as (typeof CONFIG_KEYS)[number];
  let parsed: string | boolean | null = value;
  if (k === "stream") {
    if (["true", "1", "yes"].includes(value.toLowerCase())) parsed = true;
    else if (["false", "0", "no"].includes(value.toLowerCase())) parsed = false;
    else throw new UsageError(`Invalid boolean "${value}" for "stream".`);
  }
  config.set(k, parsed as never);
  process.stdout.write(`${theme.success}${k} = ${String(parsed)}${theme.reset}\n`);
  return 0;
}

/** `coder settings privacy on|off` — privacy profile toggle. */
export async function settingsPrivacyCommand(ctx: AppContext, value: string): Promise<number> {
  const { theme } = ctx;
  const enabled = value === "on";
  if (!["on", "off"].includes(value)) {
    throw new UsageError('Usage: coder settings privacy on|off');
  }
  const settings = setPrivacyProfile(enabled);
  const synced = await pushSettingsToBackend(settings);
  process.stdout.write(
    `${theme.success}Privacy mode ${enabled ? "enabled" : "disabled"}.${theme.reset}\n` +
      `  history recording: ${settings.historyEnabled ? "on" : "off"}\n` +
      `  training data:     ${settings.trainingOptIn ? "on" : "off"}${synced ? "" : `${theme.dim} (not synced — sign in to sync)${theme.reset}`}\n`,
  );
  return 0;
}

export async function settingsHistoryCommand(ctx: AppContext, value: string): Promise<number> {
  const { theme } = ctx;
  if (!["on", "off"].includes(value)) throw new UsageError("Usage: coder settings history on|off");
  const settings = saveSettings({ ...loadSettings(), historyEnabled: value === "on" });
  const synced = await pushSettingsToBackend(settings);
  process.stdout.write(
    `${theme.success}History recording ${value === "on" ? "enabled" : "disabled"}.${theme.reset}${synced ? "" : `${theme.dim} (not synced)${theme.reset}`}\n`,
  );
  return 0;
}

export async function settingsTrainingCommand(ctx: AppContext, value: string): Promise<number> {
  const { theme } = ctx;
  if (!["on", "off"].includes(value)) throw new UsageError("Usage: coder settings training on|off");
  const settings = saveSettings({ ...loadSettings(), trainingOptIn: value === "on" });
  const synced = await pushSettingsToBackend(settings);
  process.stdout.write(
    `${theme.success}Training data collection ${value === "on" ? "enabled (opt-in)" : "disabled"}.${theme.reset}` +
      `${synced ? "" : `${theme.dim} (not synced)${theme.reset}`}\n` +
      `${value === "on" ? `${theme.dim}Records created from now on may be included in the training dataset. You can revoke this at any time.${theme.reset}\n` : ""}`,
  );
  return 0;
}

// ------------------------------------------------------------ `coder privacy`

export async function privacyStatusCommand(ctx: AppContext): Promise<number> {
  const settings = loadSettings();
  const session = loadSession();
  const rows = [
    ["history", settings.historyEnabled ? "on" : "off", "record prompts & responses"],
    ["training", settings.trainingOptIn ? "on (opted in)" : "off", "include data in training (opt-in)"],
  ];
  process.stdout.write(
    `${renderTable(["SETTING", "VALUE", "MEANING"], rows)}\n` +
      `${session ? `${ctx.theme.dim}Account: ${session.user.email} · settings sync to backend when online${ctx.theme.reset}` : `${ctx.theme.dim}Not signed in — settings apply locally.${ctx.theme.reset}`}\n`,
  );
  return 0;
}
