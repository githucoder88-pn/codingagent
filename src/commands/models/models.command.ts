/**
 * CODER — `coder models` / `coder model` commands.
 *
 * `models` lists the active provider's catalogue (cached in SQLite, with a
 * built-in offline fallback); `model use/current/list` manage the active
 * model selection.
 */

import { type AppContext } from "../../core/application/application.js";
import { UsageError } from "../../core/errors/index.js";
import { renderTable } from "../../ui/components/primitives.js";
import { type Model } from "../../types/index.js";

export interface ModelsOptions {
  providerId?: string;
  refresh?: boolean;
}

function formatModelsTable(models: Model[], activeModel: string | undefined, theme: { success: string; reset: string; dim: string }): string {
  const rows = models.map((m) => [
    m.id,
    m.provider,
    m.contextWindow > 0 ? String(m.contextWindow) : "—",
    m.supportsTools ? "yes" : "no",
    m.id === activeModel ? `${theme.success}*${theme.reset}` : "",
  ]);
  return `${renderTable(["MODEL", "PROVIDER", "CONTEXT", "TOOLS", ""], rows)}\n${theme.dim}* = active model${theme.reset}`;
}

export async function modelsCommand(ctx: AppContext, opts: ModelsOptions = {}): Promise<number> {
  const { registry, logger, theme } = ctx;
  const providerId = opts.providerId ?? ctx.settings().provider;
  const activeModel = ctx.settings().model ?? undefined;

  if (!registry.has(providerId)) {
    throw new UsageError(`Unknown provider "${providerId}". Run \`coder provider list\` to see providers.`);
  }

  const models = await registry.listModels(providerId, {
    refresh: opts.refresh,
    log: (msg) => logger.warn(msg),
  });
  process.stdout.write(`${formatModelsTable(models, activeModel, theme)}\n`);
  return 0;
}

export async function modelListCommand(ctx: AppContext, opts: ModelsOptions = {}): Promise<number> {
  return modelsCommand(ctx, opts);
}

export async function modelUseCommand(ctx: AppContext, modelId: string): Promise<number> {
  const { config, registry, theme, logger } = ctx;
  if (!modelId.trim()) {
    throw new UsageError("Usage: coder model use <model-id>");
  }
  const id = modelId.trim();
  const providerId = ctx.settings().provider;
  const provider = registry.get(providerId);

  // Verify the model exists when the catalogue is reachable; warn otherwise.
  try {
    const models = await registry.listModels(providerId, { log: () => {} });
    if (!models.some((m) => m.id === id)) {
      logger.warn(`Model "${id}" is not in ${provider.name}'s catalogue. Set anyway? (Run \`coder models\` to list models.)`);
    }
  } catch {
    // Catalogue unreachable — accept the model id as-is.
  }

  config.set("model", id);
  process.stdout.write(
    `${theme.success}Active model set to ${id} (${provider.name}).${theme.reset}\n`,
  );
  return 0;
}

export async function modelCurrentCommand(ctx: AppContext): Promise<number> {
  const { registry, theme } = ctx;
  const settings = ctx.settings();
  const { provider, model } = registry.resolve(settings.provider, settings.model);
  process.stdout.write(
    `${theme.bold}${model}${theme.reset}${theme.dim} on ${provider.name} (${provider.id})${theme.reset}\n`,
  );
  return 0;
}
