/**
 * CODER — configuration defaults.
 *
 * Default values for every configuration key. These mirror
 * src/core/constants DEFAULTS but live in the config layer where the
 * zod schema can validate them.
 */

import { DEFAULTS, ENV as ENV_KEYS } from "../../core/constants/index.js";

export const ENV = ENV_KEYS;

export const DEFAULT_THEME = "default";

export const AVAILABLE_THEMES = ["default", "dark", "light", "none"] as const;

export const CONFIG_DEFAULTS = {
  provider: DEFAULTS.provider,
  model: DEFAULTS.model,
  theme: DEFAULT_THEME,
  stream: DEFAULTS.stream,
} as const;

/** Legacy export — env values are now read at call time (see ConfigManager). */
export const ENV_OVERRIDES = {
  provider: process.env.CODER_PROVIDER,
  model: process.env.CODER_MODEL,
  theme: process.env.CODER_THEME,
  stream: process.env.CODER_STREAM,
} as const;
