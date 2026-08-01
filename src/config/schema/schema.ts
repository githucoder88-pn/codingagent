/**
 * CODER — configuration schema (zod).
 *
 * Validates `~/.coder/config.json` and `~/.coder/providers.json`. Invalid
 * files surface as ConfigError with a precise message instead of failing
 * somewhere deep inside the app.
 */

import { z } from "zod";
import { AVAILABLE_THEMES } from "../defaults/index.js";

/** The `config.json` schema. */
export const configSchema = z
  .object({
    provider: z.string().min(1).describe("Active provider id"),
    model: z.string().min(1).nullable().describe("Active model id (null = provider default)"),
    theme: z.enum(AVAILABLE_THEMES).describe("UI theme"),
    stream: z.boolean().describe("Stream responses by default"),
  })
  .strict();

export type ConfigFile = z.infer<typeof configSchema>;

/** The `providers.json` schema — maps provider id → stored account. */
export const providersSchema = z.record(
  z.string().min(1),
  z
    .object({
      apiKey: z.string().min(1),
      baseUrl: z.string().url().optional(),
      configuredAt: z.string().datetime({ offset: true }),
    })
    .strict(),
);

export type ProvidersFile = z.infer<typeof providersSchema>;
