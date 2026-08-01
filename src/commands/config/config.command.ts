/**
 * CODER — `coder config` commands.
 *
 * Inspect and mutate ~/.coder/config.json: show, get, set, path.
 */

import { type AppContext } from "../../core/application/application.js";
import { UsageError, ConfigError } from "../../core/errors/index.js";
import { AVAILABLE_THEMES } from "../../config/defaults/index.js";

export type ConfigKey = "provider" | "model" | "theme" | "stream";

const KEYS: ConfigKey[] = ["provider", "model", "theme", "stream"];

function parseValue(key: ConfigKey, raw: string): string | boolean | null {
  if (key === "stream") {
    if (["true", "1", "yes"].includes(raw.toLowerCase())) return true;
    if (["false", "0", "no"].includes(raw.toLowerCase())) return false;
    throw new UsageError(`Invalid boolean "${raw}" for "stream" (use true/false).`);
  }
  if (key === "model" && raw.trim() === "") return null;
  if (key === "theme" && !(AVAILABLE_THEMES as readonly string[]).includes(raw)) {
    throw new UsageError(`Unknown theme "${raw}". Available themes: ${AVAILABLE_THEMES.join(", ")}`);
  }
  return raw;
}

export async function configShowCommand(ctx: AppContext): Promise<number> {
  const { config, theme } = ctx;
  const settings = ctx.settings();
  const file = config.all();
  const lines = [
    `${theme.bold}Configuration (${config.path()})${theme.reset}`,
    ...KEYS.map((k) => {
      const value = file[k];
      const effective = settings[k as keyof typeof settings];
      const override = String(effective) !== String(value ?? "") ? `  ${theme.dim}(effective: ${String(effective)})${theme.reset}` : "";
      return `  ${k.padEnd(8)}: ${String(value)}${override}`;
    }),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

export async function configGetCommand(ctx: AppContext, key: string): Promise<number> {
  const { config } = ctx;
  if (!(KEYS as string[]).includes(key)) {
    throw new UsageError(`Unknown config key "${key}". Valid keys: ${KEYS.join(", ")}`);
  }
  const k = key as ConfigKey;
  const value = config.get(k);
  process.stdout.write(`${value === null ? "" : String(value)}\n`);
  return 0;
}

export async function configSetCommand(ctx: AppContext, key: string, rawValue: string): Promise<number> {
  const { config, registry, theme } = ctx;
  if (!(KEYS as string[]).includes(key)) {
    throw new UsageError(`Unknown config key "${key}". Valid keys: ${KEYS.join(", ")}`);
  }
  const k = key as ConfigKey;
  const value = parseValue(k, rawValue);

  if (k === "provider" && typeof value === "string" && !registry.has(value)) {
    throw new ConfigError(`Unknown provider "${value}". Run \`coder provider list\` to see providers.`);
  }

  config.set(k, value as never);
  process.stdout.write(`${theme.success}${key} = ${String(value)}${theme.reset}\n`);
  return 0;
}

export async function configPathCommand(ctx: AppContext): Promise<number> {
  process.stdout.write(`${ctx.config.path()}\n`);
  return 0;
}
