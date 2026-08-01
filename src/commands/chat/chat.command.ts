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
  await runChatScreen(ctx, {
    ...opts,
    onTurnComplete: (info) => {
      // Phase 2: record each completed turn (privacy-gated, best-effort).
      void (async () => {
        const lastUser = [...info.session.messages].reverse().find((m) => m.role === "user");
        const lastAssistant = [...info.session.messages].reverse().find((m) => m.role === "assistant");
        if (!lastUser) return;
        const { recordTurn } = await import("../../account/recorder.js");
        await recordTurn(ctx, {
          sessionId: info.session.id,
          provider: info.session.provider,
          model: info.session.model,
          prompt: lastUser.content,
          response: lastAssistant?.content ?? "",
          latencyMs: info.durationMs,
        });
      })();
    },
  });
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

  // Phase 2: record the turn (privacy-gated) and sync to the backend.
  let recordId: string | undefined;
  const { recordTurn } = await import("../../account/recorder.js");
  const recorded = await recordTurn(ctx, {
    sessionId: result.session.id,
    provider: providerId,
    model,
    prompt: opts.prompt,
    response: result.response.content,
    tokensUsed: result.response.usage.outputTokens,
    latencyMs: result.durationMs,
  });
  if (recorded.recorded) recordId = recorded.recordId;

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
          durationMs: result.durationMs,
          recordId,
          recorded: recordId !== undefined,
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
