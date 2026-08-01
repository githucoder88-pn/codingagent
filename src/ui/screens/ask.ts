/**
 * CODER — `coder ask` runner.
 *
 * One-shot prompt: sends the user's message through the active provider,
 * streams (or prints) the reply, persists both messages to the current
 * session and returns the result for callers and tests.
 */

import { type AppContext } from "../../core/application/application.js";
import { type AskResult, type Session } from "../../types/index.js";
import { CoderError } from "../../core/errors/index.js";
import { Spinner } from "../components/primitives.js";
import { knownModelInfo } from "../../providers/known-models.js";

export interface AskOptions {
  prompt: string;
  provider?: string;
  model?: string;
  stream?: boolean;
  /** Continue an existing session instead of the current one. */
  sessionId?: string;
  /** Print the reply to stdout (default true). */
  print?: boolean;
  onDelta?: (delta: string) => void;
}

export async function runAsk(ctx: AppContext, opts: AskOptions): Promise<AskResult> {
  const settings = ctx.settings();
  const providerId = opts.provider ?? settings.provider;
  const { provider, model } = ctx.registry.resolve(providerId, opts.model ?? settings.model);
  const stream = opts.stream ?? settings.stream;

  let session: Session;
  if (opts.sessionId) {
    const existing = ctx.sessions.load(opts.sessionId);
    if (!existing) {
      throw new CoderError(`Session "${opts.sessionId}" not found. Run \`coder sessions list\` to see sessions.`);
    }
    session = existing;
  } else {
    session = ctx.history.getOrCreateCurrent(provider.id, model);
  }

  // The session may have been created with a different provider/model; the
  // request always uses what the user asked for this invocation.
  const messages = [...session.messages, { role: "user" as const, content: opts.prompt }];
  const info = knownModelInfo(model);
  const trimmed = ctx.memory.trimToBudget(messages, {
    budgetTokens: info.contextWindow > 0 ? Math.floor(info.contextWindow * 0.7) : 0,
  });

  const showProgress = opts.print !== false;
  const spinner = new Spinner(process.stdout);
  const request = { model, messages: trimmed };
  let content = "";
  let streamed = false;
  const startedAt = Date.now();

  ctx.logger.info(`ask: provider=${provider.id} model=${model} session=${session.id} stream=${stream}`);

  let response: AskResult["response"];
  try {
    if (stream) {
      if (showProgress) spinner.start("Thinking…");
      for await (const delta of ctx.registry.stream(provider.id, request)) {
        if (!streamed) {
          streamed = true;
          spinner.stop();
        }
        content += delta;
        opts.onDelta?.(delta);
        if (showProgress) process.stdout.write(delta);
      }
      spinner.stop();
      if (showProgress && content && !content.endsWith("\n")) {
        process.stdout.write("\n");
      }
      response = {
        id: `stream-${Date.now()}`,
        model,
        content,
        usage: {},
        createdAt: new Date().toISOString(),
      };
    } else {
      if (showProgress) spinner.start("Thinking…");
      response = await ctx.registry.chat(provider.id, request);
      spinner.stop();
      content = response.content;
      if (showProgress) process.stdout.write(`${content}\n`);
    }
  } catch (err) {
    spinner.stop();
    throw err;
  }

  const durationMs = Date.now() - startedAt;

  session = ctx.sessions.addMessage(session, { role: "user", content: opts.prompt });
  if (content.trim() !== "") {
    session = ctx.sessions.addMessage(session, { role: "assistant", content });
  }
  ctx.memory.remember(session);
  ctx.logger.info(`ask complete: session=${session.id} streamed=${streamed} durationMs=${durationMs}`);

  return { session, response, streamed };
}
