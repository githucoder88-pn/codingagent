/**
 * CODER — `coder chat`, `coder ask`, `coder clear` commands.
 */

import { type AppContext } from "../../core/application/application.js";
import { runChatScreen, type ChatScreenOptions } from "../../ui/screens/chat-screen.js";
import { runAsk, type AskOptions } from "../../ui/screens/ask.js";
import { AuthError, UsageError } from "../../core/errors/index.js";

export interface ChatCommandOptions extends ChatScreenOptions {}

export async function chatCommand(ctx: AppContext, opts: ChatCommandOptions = {}): Promise<number> {
  const settings = ctx.settings();
  const { provider, model } = ctx.registry.resolve(settings.provider, settings.model);
  if (provider.requiresKey && !ctx.config.getAccount(provider.id)) {
    throw new AuthError(
      `Provider "${provider.id}" is not configured. Run \`coder auth ${provider.id}\` first.`,
    );
  }
  await runChatScreen(ctx, opts);
  return 0;
}

export interface AskCommandOptions {
  prompt: string;
  provider?: string;
  model?: string;
  stream: boolean;
  sessionId?: string;
  json?: boolean;
}

export async function askCommand(ctx: AppContext, opts: AskCommandOptions): Promise<number> {
  if (!opts.prompt.trim()) {
    throw new UsageError('Usage: coder ask "<your prompt>"');
  }
  const settings = ctx.settings();
  const providerId = opts.provider ?? settings.provider;
  const { provider, model } = ctx.registry.resolve(providerId, opts.model ?? settings.model);
  if (provider.requiresKey && !ctx.config.getAccount(provider.id)) {
    throw new AuthError(
      `Provider "${provider.id}" is not configured. Run \`coder auth ${provider.id}\` first.`,
    );
  }

  const askOpts: AskOptions = {
    prompt: opts.prompt,
    provider: providerId,
    model,
    stream: opts.stream,
    sessionId: opts.sessionId,
    print: !opts.json,
  };

  const result = await runAsk(ctx, askOpts);

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          sessionId: result.session.id,
          provider: providerId,
          model,
          content: result.response.content,
          usage: result.response.usage,
          streamed: result.streamed,
          createdAt: result.response.createdAt,
        },
        null,
        2,
      )}\n`,
    );
  }
  return 0;
}

export async function clearCommand(ctx: AppContext): Promise<number> {
  const { history, theme, logger } = ctx;
  const current = history.currentId();
  if (!current) {
    process.stdout.write(`${theme.dim}No active session to clear.${theme.reset}\n`);
    return 0;
  }
  history.clearCurrent();
  logger.info(`Cleared session "${current}"`);
  process.stdout.write(`${theme.success}Session ${current} cleared.${theme.reset}\n`);
  return 0;
}
