/**
 * CODER — `coder provider` commands.
 *
 * Provider selection and inspection: list, current, use.
 */

import { type AppContext } from "../../core/application/application.js";
import { UsageError } from "../../core/errors/index.js";
import { renderTable } from "../../ui/components/primitives.js";

export async function providerListCommand(ctx: AppContext): Promise<number> {
  const { registry, config, theme } = ctx;
  const active = ctx.settings().provider;
  const rows = registry.list().map((p) => {
    const configured = !p.requiresKey || config.getAccount(p.id) !== undefined;
    return [
      `${p.id}${p.id === active ? "*" : ""}`,
      p.name,
      configured ? "configured" : "not configured",
    ];
  });
  process.stdout.write(`${renderTable(["PROVIDER", "NAME", "STATUS"], rows)}\n`);
  process.stdout.write(`${theme.dim}* = active provider${theme.reset}\n`);
  return 0;
}

export async function providerCurrentCommand(ctx: AppContext): Promise<number> {
  const { registry, theme } = ctx;
  const settings = ctx.settings();
  const provider = registry.get(settings.provider);
  const model = settings.model ?? provider.defaultModel;
  process.stdout.write(
    `${theme.bold}${provider.name}${theme.reset}${theme.dim} (${provider.id}) — model ${model}${theme.reset}\n`,
  );
  return 0;
}

export async function providerUseCommand(ctx: AppContext, providerId: string): Promise<number> {
  const { registry, config, theme, logger } = ctx;
  if (!registry.has(providerId)) {
    throw new UsageError(`Unknown provider "${providerId}". Run \`coder provider list\` to see providers.`);
  }
  const provider = registry.get(providerId);

  // A model id from another provider ("anthropic/…" on openai, etc.) is
  // almost certainly wrong — reset it to the provider default.
  const currentModel = config.get("model");
  const looksForeign =
    currentModel !== null &&
    (providerId === "openrouter"
      ? !currentModel.includes("/")
      : currentModel.includes("/"));
  if (looksForeign) {
    config.set("model", null);
    logger.warn(`Reset model to ${provider.defaultModel} (previous model "${currentModel}" does not belong to ${provider.name}).`);
  }

  config.set("provider", providerId);
  process.stdout.write(
    `${theme.success}Active provider set to ${provider.name}${currentModel ? "" : ` (model ${provider.defaultModel})`}.${theme.reset}\n`,
  );
  return 0;
}
