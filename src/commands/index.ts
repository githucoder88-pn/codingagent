/**
 * CODER — command registration.
 *
 * Builds the Commander program and wires every command group to the
 * application context. Handlers return an exit code which `runCli`
 * propagates.
 */

import { Command } from "commander";
import { APP_DISPLAY_NAME, EXIT, PHASE, VERSION } from "../core/constants/index.js";
import { type AppContext, type CreateAppOptions } from "../core/application/application.js";
import { createApp } from "../core/application/application.js";
import { authCommand, authListCommand, authRemoveCommand, authStatusCommand } from "./auth/auth.command.js";
import { modelsCommand, modelUseCommand, modelCurrentCommand, modelListCommand } from "./models/models.command.js";
import { providerListCommand, providerCurrentCommand, providerUseCommand } from "./provider/provider.command.js";
import { configShowCommand, configGetCommand, configSetCommand, configPathCommand } from "./config/config.command.js";
import { chatCommand, askCommand, clearCommand } from "./chat/chat.command.js";
import { sessionsListCommand, sessionsCurrentCommand, sessionsShowCommand, sessionsRemoveCommand } from "./sessions/sessions.command.js";
import { renderHelp } from "./help/help.command.js";
import { debugEnabled } from "../logger/console/console-logger.js";

export interface GlobalOptions {
  debug?: boolean;
}

export type CommandHandler = (ctx: AppContext, ...args: any[]) => Promise<number>;

/**
 * Build the program. `createCtx` runs lazily so `coder --help` never
 * touches the filesystem.
 */
export function buildProgram(createCtx?: (opts: GlobalOptions) => Promise<AppContext>): Command {
  let exitCode: number = EXIT.OK;

  const getCtx = async (opts: GlobalOptions = {}): Promise<AppContext> => {
    if (!createCtx) {
      throw new Error("No application factory provided (programmatic usage).");
    }
    return createCtx(opts);
  };

  const program = new Command();
  program
    .name("coder")
    .description(`${APP_DISPLAY_NAME} — ${PHASE}`)
    .version(VERSION, "-v, --version")
    .option("--debug", "enable verbose logging (also: CODER_DEBUG=1)")
    .showHelpAfterError()
    .exitOverride();

  const wrap = (fn: CommandHandler) => {
    return async (...args: any[]): Promise<void> => {
      const opts = program.opts<GlobalOptions>();
      const ctx = await getCtx(opts);
      exitCode = await fn(ctx, ...args);
    };
  };

  // ------------------------------------------------------------- chat
  program
    .command("chat")
    .description("Start an interactive chat session")
    .option("--no-stream", "disable streaming responses")
    .option("--repl", "force the readline REPL UI (no Ink TUI)")
    .action(wrap(async (ctx, opts: { stream: boolean; repl: boolean }) => {
      return chatCommand(ctx, { stream: opts.stream, forceRepl: opts.repl });
    }));

  program
    .command("ask <prompt...>")
    .description("Ask a one-shot prompt (continues the current session)")
    .option("--provider <id>", "provider to use for this request")
    .option("--model <id>", "model to use for this request")
    .option("--no-stream", "disable streaming")
    .option("--session <id>", "continue an existing session")
    .option("--json", "print the result as JSON (suppresses the reply text)")
    .action(wrap(async (ctx, promptArgs: string[], opts: { provider?: string; model?: string; stream: boolean; session?: string; json: boolean }) => {
      return askCommand(ctx, {
        prompt: promptArgs.join(" "),
        provider: opts.provider,
        model: opts.model,
        stream: opts.stream,
        sessionId: opts.session,
        json: opts.json,
      });
    }));

  program
    .command("clear")
    .description("Clear the current session's messages")
    .action(wrap(async (ctx) => clearCommand(ctx)));

  // ------------------------------------------------------------- auth
  const auth = program
    .command("auth")
    .description("Manage provider API keys (openai | anthropic | gemini | openrouter)")
    .argument("[provider]", "provider id")
    .option("--key <key>", "API key (non-interactive)")
    .option("--base-url <url>", "custom API base URL (advanced)")
    .action(wrap(async (ctx, provider: string | undefined, opts: { key?: string; baseUrl?: string }) => {
      if (!provider) {
        process.stdout.write("Usage: coder auth <provider> [--key <key>]\nRun `coder auth status` to see provider states.\n");
        return EXIT.USAGE;
      }
      return authCommand(ctx, { providerId: provider, key: opts.key, baseUrl: opts.baseUrl });
    }));

  auth
    .command("list")
    .description("List stored API keys")
    .action(wrap(async (ctx) => authListCommand(ctx)));

  auth
    .command("status")
    .description("Show the configuration state of every provider")
    .action(wrap(async (ctx) => authStatusCommand(ctx)));

  auth
    .command("remove <provider>")
    .description("Remove a stored API key")
    .action(wrap(async (ctx, provider: string) => authRemoveCommand(ctx, provider)));

  // ------------------------------------------------------------ models
  const models = program
    .command("models")
    .description("List models for the active provider")
    .option("--provider <id>", "list models for a specific provider")
    .option("--refresh", "bypass the cache and fetch fresh")
    .action(wrap(async (ctx, opts: { provider?: string; refresh: boolean }) => {
      return modelsCommand(ctx, { providerId: opts.provider, refresh: opts.refresh });
    }));

  models
    .command("list")
    .description("Alias for `coder models`")
    .option("--provider <id>", "list models for a specific provider")
    .action(wrap(async (ctx, opts: { provider?: string }) => modelsCommand(ctx, { providerId: opts.provider })));

  models
    .command("refresh")
    .description("Fetch the model catalogue fresh (bypasses the cache)")
    .option("--provider <id>", "refresh a specific provider")
    .action(wrap(async (ctx, opts: { provider?: string }) => modelsCommand(ctx, { providerId: opts.provider, refresh: true })));

  const model = program
    .command("model")
    .description("Manage the active model")
    .action(wrap(async (ctx) => modelCurrentCommand(ctx)));

  model
    .command("use <model-id>")
    .description("Set the active model")
    .action(wrap(async (ctx, modelId: string) => modelUseCommand(ctx, modelId)));

  model
    .command("current")
    .description("Show the active model")
    .action(wrap(async (ctx) => modelCurrentCommand(ctx)));

  model
    .command("list")
    .description("Alias for `coder models`")
    .option("--provider <id>", "list models for a specific provider")
    .action(wrap(async (ctx, opts: { provider?: string }) => modelListCommand(ctx, { providerId: opts.provider })));

  // ---------------------------------------------------------- provider
  const provider = program
    .command("provider")
    .description("Manage the active provider")
    .action(wrap(async (ctx) => providerListCommand(ctx)));

  provider
    .command("list")
    .description("List available providers")
    .action(wrap(async (ctx) => providerListCommand(ctx)));

  provider
    .command("current")
    .description("Show the active provider")
    .action(wrap(async (ctx) => providerCurrentCommand(ctx)));

  provider
    .command("use <provider-id>")
    .description("Set the active provider")
    .action(wrap(async (ctx, providerId: string) => providerUseCommand(ctx, providerId)));

  // ------------------------------------------------------------ config
  const config = program
    .command("config")
    .description("Inspect or change configuration")
    .action(wrap(async (ctx) => configShowCommand(ctx)));

  config
    .command("show")
    .description("Show the effective configuration")
    .action(wrap(async (ctx) => configShowCommand(ctx)));

  config
    .command("get <key>")
    .description("Print one configuration value (provider | model | theme | stream)")
    .action(wrap(async (ctx, key: string) => configGetCommand(ctx, key)));

  config
    .command("set <key> <value>")
    .description("Set one configuration value")
    .action(wrap(async (ctx, key: string, value: string) => configSetCommand(ctx, key, value)));

  config
    .command("path")
    .description("Print the config file path")
    .action(wrap(async (ctx) => configPathCommand(ctx)));

  // ---------------------------------------------------------- sessions
  const sessions = program
    .command("sessions")
    .description("Manage saved conversation sessions")
    .action(wrap(async (ctx) => sessionsListCommand(ctx)));

  sessions
    .command("list")
    .description("List sessions")
    .action(wrap(async (ctx) => sessionsListCommand(ctx)));

  sessions
    .command("current")
    .description("Show the current session id")
    .action(wrap(async (ctx) => sessionsCurrentCommand(ctx)));

  sessions
    .command("show <session-id>")
    .description("Show a session's messages")
    .action(wrap(async (ctx, sessionId: string) => sessionsShowCommand(ctx, sessionId)));

  sessions
    .command("remove <session-id>")
    .description("Delete a session")
    .action(wrap(async (ctx, sessionId: string) => sessionsRemoveCommand(ctx, sessionId)));

  // -------------------------------------------------------------- help
  program.addHelpCommand(false);
  program
    .command("help")
    .description("Show CODER help")
    .action(wrap(async (ctx) => {
      process.stdout.write(`${renderHelp(ctx.theme)}\n`);
      return EXIT.OK;
    }));

  // expose exit-code plumbing for runCli
  (program as unknown as { _coderExitCode: () => number })._coderExitCode = () => exitCode;
  return program;
}

export { EXIT };

/** Default context factory used by the CLI entry. */
export async function defaultCreateCtx(opts: GlobalOptions, extra?: CreateAppOptions): Promise<AppContext> {
  return createApp({
    consoleDebug: opts.debug || debugEnabled(),
    ...extra,
  });
}
