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
import { authAddCommand, authListCommand, authRemoveCommand, authStatusCommand } from "./auth/auth.command.js";
import { modelsCommand, modelUseCommand, modelCurrentCommand, modelListCommand } from "./models/models.command.js";
import { providerListCommand, providerCurrentCommand, providerUseCommand } from "./provider/provider.command.js";
import { configShowCommand, configGetCommand, configSetCommand, configPathCommand } from "./config/config.command.js";
import { chatCommand, askCommand, clearCommand } from "./chat/chat.command.js";
import { sessionsListCommand, sessionsCurrentCommand, sessionsShowCommand, sessionsRemoveCommand } from "./sessions/sessions.command.js";
import { loginCommand, signupCommand, logoutCommand, deleteAccountCommand } from "./account/login.command.js";
import { serverStartCommand, serverStatusCommand, serverStopCommand } from "./server/server.command.js";
import { dashboardCommand } from "./dashboard/dashboard.command.js";
import {
  settingsShowCommand,
  settingsSetCommand,
  settingsPrivacyCommand,
  settingsHistoryCommand,
  settingsTrainingCommand,
  privacyStatusCommand,
} from "./settings/settings.command.js";
import { feedbackCommand } from "./feedback/feedback.command.js";
import { historyCommand } from "./history/history.command.js";
import { exportCommand } from "./export/export.command.js";
import { syncCommand } from "./sync/sync.command.js";
import {
  adminUsersCommand,
  adminPromptsCommand,
  adminFeedbackCommand,
  adminLogsCommand,
  adminTrainingCommand,
  adminUsageCommand,
  adminModelsCommand,
  adminRotateKeyCommand,
  type AdminListOptions,
} from "./admin/admin.command.js";
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
    .description("Manage provider API keys (add | list | status | remove) — encrypted at rest")
    .argument("[provider]", "provider id (alias for `auth add`)")
    .option("--key <key>", "API key (non-interactive)")
    .option("--base-url <url>", "custom API base URL (advanced)")
    .option("--no-upload", "store locally only (skip backend sync)")
    .action(wrap(async (ctx, provider: string | undefined, opts: { key?: string; baseUrl?: string; upload: boolean }) => {
      if (provider) {
        // Backwards-compatible alias: `coder auth openai` → add.
        return authAddCommand(ctx, { providerId: provider, key: opts.key, baseUrl: opts.baseUrl, noUpload: !opts.upload });
      }
      process.stdout.write("Usage: coder auth add <provider> [--key <key>]\nRun `coder auth status` to see provider states.\n");
      return EXIT.USAGE;
    }));

  // Note: --key/--base-url/--no-upload are declared on the parent `auth`
  // command (Commander rejects duplicate option names on children); the
  // `add` subcommand reads them via cmd.parent.opts().
  auth
    .command("add <provider>")
    .description("Store an API key (encrypted locally + synced to the backend)")
    .action(wrap(async (ctx, provider: string, _opts: Record<string, never>, cmd: Command) => {
      const parent = cmd.parent?.opts<{ key?: string; baseUrl?: string; upload?: boolean }>() ?? {};
      return authAddCommand(ctx, {
        providerId: provider,
        key: parent.key,
        baseUrl: parent.baseUrl,
        noUpload: parent.upload === false,
      });
    }));

  auth
    .command("list")
    .description("List stored API keys (local + backend sync state)")
    .action(wrap(async (ctx) => authListCommand(ctx)));

  auth
    .command("status")
    .description("Show the configuration state of every provider")
    .action(wrap(async (ctx) => authStatusCommand(ctx)));

  auth
    .command("remove <provider>")
    .description("Remove a stored API key (local + backend)")
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

  // ----------------------------------------------------------- account
  program
    .command("login")
    .description("Sign in to your CODER account")
    .option("--email <email>", "account email (non-interactive)")
    .option("--password <password>", "account password (non-interactive)")
    .option("--server <url>", "backend URL (default http://127.0.0.1:8747)")
    .action(wrap(async (ctx, opts: { email?: string; password?: string; server?: string }) => {
      return loginCommand(ctx, { email: opts.email, password: opts.password, serverUrl: opts.server });
    }));

  program
    .command("signup")
    .description("Create a CODER account (then signs you in)")
    .option("--email <email>", "account email (non-interactive)")
    .option("--password <password>", "account password, min 8 chars (non-interactive)")
    .option("--server <url>", "backend URL (default http://127.0.0.1:8747)")
    .action(wrap(async (ctx, opts: { email?: string; password?: string; server?: string }) => {
      return signupCommand(ctx, { email: opts.email, password: opts.password, serverUrl: opts.server });
    }));

  program
    .command("logout")
    .description("Sign out (local session cleared)")
    .action(wrap(async (ctx) => logoutCommand(ctx)));

  program
    .command("delete-account")
    .description("Permanently delete your account and backend data")
    .option("--yes", "skip confirmation")
    .option("--wipe-local", "also delete local session history files")
    .action(wrap(async (ctx, opts: { yes?: boolean; wipeLocal?: boolean }) => {
      return deleteAccountCommand(ctx, { yes: opts.yes, wipeLocal: opts.wipeLocal });
    }));

  // ------------------------------------------------------------ server
  const server = program
    .command("server")
    .description("Manage the local CODER backend (control plane)")
    .action(wrap(async (ctx) => serverStatusCommand(ctx, apiPort())));

  server
    .command("start")
    .description("Start the backend (detached)")
    .option("--port <port>", "port (default 8747)")
    .option("--foreground", "run in the foreground")
    .action(wrap(async (ctx, opts: { port?: string; foreground?: boolean }) => {
      return serverStartCommand(ctx, { port: opts.port ? Number(opts.port) : undefined, foreground: opts.foreground });
    }));

  server
    .command("status")
    .description("Show backend health")
    .option("--port <port>", "port (default 8747)")
    .action(wrap(async (ctx, opts: { port?: string }) => serverStatusCommand(ctx, opts.port ? Number(opts.port) : apiPort())));

  server
    .command("stop")
    .description("Stop the backend")
    .option("--port <port>", "port (default 8747)")
    .action(wrap(async (ctx, opts: { port?: string }) => serverStopCommand(ctx, opts.port ? Number(opts.port) : apiPort())));

  // ---------------------------------------------------------- dashboard
  program
    .command("dashboard")
    .description("Open the web dashboard (starts the backend if needed)")
    .option("--port <port>", "port (default 8747)")
    .option("--no-open", "print the URL without opening a browser")
    .action(wrap(async (ctx, opts: { port?: string; open: boolean }) => {
      return dashboardCommand(ctx, { port: opts.port ? Number(opts.port) : undefined, noOpen: !opts.open });
    }));

  // ----------------------------------------------------------- settings
  const settings = program
    .command("settings")
    .description("Show or change settings (config + privacy)")
    .action(wrap(async (ctx) => settingsShowCommand(ctx)));

  settings
    .command("show")
    .description("Show all settings")
    .action(wrap(async (ctx) => settingsShowCommand(ctx)));

  settings
    .command("set <key> <value>")
    .description("Set a CLI setting (provider | model | theme | stream)")
    .action(wrap(async (ctx, key: string, value: string) => settingsSetCommand(ctx, key, value)));

  settings
    .command("privacy <on|off>")
    .description("Toggle maximum-privacy mode (off = standard, on = no history/training)")
    .action(wrap(async (ctx, value: string) => settingsPrivacyCommand(ctx, value)));

  settings
    .command("history <on|off>")
    .description("Toggle prompt/response history recording")
    .action(wrap(async (ctx, value: string) => settingsHistoryCommand(ctx, value)));

  settings
    .command("training <on|off>")
    .description("Toggle training-data opt-in (always explicit, revocable)")
    .action(wrap(async (ctx, value: string) => settingsTrainingCommand(ctx, value)));

  // ------------------------------------------------------------ privacy
  const privacy = program
    .command("privacy")
    .description("Privacy controls (history, training, status)")
    .action(wrap(async (ctx) => privacyStatusCommand(ctx)));

  privacy
    .command("status")
    .description("Show privacy settings")
    .action(wrap(async (ctx) => privacyStatusCommand(ctx)));

  privacy
    .command("history <on|off>")
    .description("Toggle history recording")
    .action(wrap(async (ctx, value: string) => settingsHistoryCommand(ctx, value)));

  privacy
    .command("training <on|off>")
    .description("Toggle training opt-in")
    .action(wrap(async (ctx, value: string) => settingsTrainingCommand(ctx, value)));

  // ----------------------------------------------------------- feedback
  program
    .command("feedback <rating>")
    .description("Rate the last response (1-5) with an optional comment")
    .argument("[comment...]", "optional comment")
    .action(wrap(async (ctx, rating: string, commentArgs: string[]) => {
      const ratingNum = Number(rating);
      if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        process.stdout.write("Rating must be an integer 1-5.\n");
        return EXIT.USAGE;
      }
      return feedbackCommand(ctx, { rating: ratingNum, comment: commentArgs.join(" ") || undefined });
    }));

  // ------------------------------------------------------------ history
  program
    .command("history")
    .description("Show your prompt/response history")
    .option("--remote", "read history from the backend instead of local records")
    .option("--limit <n>", "max entries", "25")
    .option("--json", "raw JSON output")
    .action(wrap(async (ctx, opts: { remote?: boolean; limit?: string; json?: boolean }) => {
      return historyCommand(ctx, { remote: opts.remote, limit: Number(opts.limit ?? 25), json: opts.json });
    }));

  // ------------------------------------------------------------- export
  program
    .command("export")
    .description("Export your data as JSON (local + backend)")
    .option("--out <file>", "output file")
    .option("--local-only", "skip the backend bundle")
    .action(wrap(async (ctx, opts: { out?: string; localOnly?: boolean }) => {
      return exportCommand(ctx, { out: opts.out, localOnly: opts.localOnly });
    }));

  // --------------------------------------------------------------- sync
  program
    .command("sync")
    .description("Push local records and keys to the backend")
    .action(wrap(async (ctx) => syncCommand(ctx)));

  // -------------------------------------------------------------- admin
  const admin = program
    .command("admin")
    .description("Admin operations (requires an admin account)")
    .option("--limit <n>", "max entries", "50")
    .option("--offset <n>", "offset", "0")
    .option("--json", "raw JSON output")
    .option("--search <q>", "search filter")
    .option("--days <n>", "usage window in days", "14")
    .action(wrap(async (ctx, opts: AdminListOptions) => {
      process.stdout.write("Usage: coder admin <users|prompts|feedback|logs|training|usage|sync|rotate-key>\n");
      return EXIT.USAGE;
    }));

  const adminOpts = (opts: AdminListOptions): AdminListOptions => ({
    limit: Number(opts.limit ?? 50),
    offset: Number(opts.offset ?? 0),
    json: opts.json,
    search: opts.search,
    days: Number(opts.days ?? 14),
  });

  admin
    .command("users")
    .description("List users")
    .option("--limit <n>", "max entries")
    .option("--offset <n>", "offset")
    .option("--search <q>", "search by email")
    .option("--json", "raw JSON output")
    .action(wrap(async (ctx, opts: AdminListOptions) => adminUsersCommand(ctx, adminOpts(opts))));

  admin
    .command("prompts")
    .description("List prompts across users")
    .option("--limit <n>", "max entries")
    .option("--offset <n>", "offset")
    .option("--json", "raw JSON output")
    .action(wrap(async (ctx, opts: AdminListOptions) => adminPromptsCommand(ctx, adminOpts(opts))));

  admin
    .command("feedback")
    .description("List feedback across users")
    .option("--limit <n>", "max entries")
    .option("--offset <n>", "offset")
    .option("--json", "raw JSON output")
    .action(wrap(async (ctx, opts: AdminListOptions) => adminFeedbackCommand(ctx, adminOpts(opts))));

  admin
    .command("logs")
    .description("List audit logs")
    .option("--limit <n>", "max entries")
    .option("--offset <n>", "offset")
    .option("--action <action>", "filter by action")
    .option("--json", "raw JSON output")
    .action(wrap(async (ctx, opts: AdminListOptions) => adminLogsCommand(ctx, adminOpts(opts))));

  admin
    .command("training")
    .description("Show training opt-in stats (and dataset with --json)")
    .option("--limit <n>", "dataset rows")
    .option("--json", "raw JSON output")
    .action(wrap(async (ctx, opts: AdminListOptions) => adminTrainingCommand(ctx, adminOpts(opts))));

  admin
    .command("usage")
    .description("Show usage analytics")
    .option("--days <n>", "window in days")
    .option("--json", "raw JSON output")
    .action(wrap(async (ctx, opts: AdminListOptions) => adminUsageCommand(ctx, adminOpts(opts))));

  admin
    .command("models")
    .description("Show provider/model metadata (from recorded prompts)")
    .option("--limit <n>", "max entries")
    .option("--search <provider>", "filter by provider")
    .option("--json", "raw JSON output")
    .action(wrap(async (ctx, opts: AdminListOptions) => adminModelsCommand(ctx, adminOpts(opts))));

  admin
    .command("rotate-key")
    .description("Rotate the master encryption key (re-encrypts all keys)")
    .option("--yes", "skip confirmation")
    .action(wrap(async (ctx, opts: { yes?: boolean }) => adminRotateKeyCommand(ctx, { yes: opts.yes })));

  admin
    .command("sync")
    .description("Push local records to the backend (same as `coder sync`)")
    .action(wrap(async (ctx) => syncCommand(ctx)));

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

/** Resolve the API port for server/dashboard commands. */
export function apiPort(): number {
  return Number(process.env.CODER_API_PORT ?? 8747);
}

export { EXIT };

/** Default context factory used by the CLI entry. */
export async function defaultCreateCtx(opts: GlobalOptions, extra?: CreateAppOptions): Promise<AppContext> {
  return createApp({
    consoleDebug: opts.debug || debugEnabled(),
    ...extra,
  });
}
