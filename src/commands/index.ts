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
import { scanCommand } from "./workspace/scan.command.js";
import { searchCommand } from "./workspace/search.command.js";
import { filesCommand } from "./workspace/files.command.js";
import { contextCommand } from "./workspace/context.command.js";
import { explainCommand } from "./workspace/explain.command.js";
import {
  diffCommand,
  undoCommand,
  redoCommand,
  checkpointsCommand,
  checkpointCreateCommand,
  checkpointRestoreCommand,
  checkpointDeleteCommand,
  toolsCommand,
} from "./workspace/workspace.commands.js";
import { agentCommand } from "./agent/agent.command.js";
import {
  rolesCommand,
  orchestrateCommand,
  planCommand,
  workflowListCommand,
  workflowInstallCommand,
  workflowRunCommand,
  mcpListCommand,
  mcpAddCommand,
  mcpRemoveCommand,
  mcpEnableCommand,
  mcpConnectCommand,
  mcpDisconnectCommand,
  mcpDiscoverCommand,
  extensionListCommand,
  extensionInstallCommand,
  extensionRemoveCommand,
  extensionUpdateCommand,
  extensionEnableCommand,
  skillListCommand,
  skillShowCommand,
  skillInstallCommand,
  skillCreateCommand,
  skillUseCommand,
  taskListCommand,
  taskRunCommand,
  taskStatusCommand,
  taskCancelCommand,
} from "./phase4/phase4.commands.js";
import { memoryStoreCommand, memoryRecallCommand, memorySearchCommand } from "./memory/memory.commands.js";
import { cognitiveStatusCommand, evolveCommand, researchCommand } from "./cognitive/cognitive.commands.js";
import {
  orgCreateCommand,
  orgListCommand,
  orgShowCommand,
  orgMemberCommand,
  orgMemoryCommand,
  orgUsageCommand,
  workspaceCreateCommand,
  workspaceListCommand,
  workspaceStartCommand,
  workspaceStopCommand,
  workspaceDestroyCommand,
  runtimeCommand,
} from "./enterprise/enterprise.commands.js";
import {
  civilizationRunCommand,
  civilizationStatusCommand,
  directorCommand,
  clusterStatusCommand,
  workerCommand,
} from "./civilization/civilization.commands.js";
import {
  knowledgeGraphCommand,
  knowledgeStatsCommand,
  knowledgeSearchCommand,
  modelBenchmarkCommand,
  modelInfoCommand,
} from "./knowledge/knowledge.commands.js";
import {
  runCommand,
  petCommand,
  daemonStartCommand,
  daemonStatusCommand,
  daemonStopCommand,
  restoreCommand,
  statusCommand,
  connectCommand,
  syncFlushCommand,
  recoverCommand,
} from "./offline/offline.commands.js";
import { renderHelp } from "./help/help.command.js";
import { debugEnabled } from "../logger/console/console-logger.js";

export interface GlobalOptions {
  debug?: boolean;
  offline?: boolean;
  pet?: boolean;
  autonomous?: boolean;
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
    .option("--offline", "force offline for this process (bare `coder --offline` opens the runtime status panel)")
    .option("--pet", "start the persistent pet (alias for `coder pet`)")
    .option("--autonomous", "run the pet in autonomous mode")
    .showHelpAfterError()
    .exitOverride();

  const wrap = (fn: CommandHandler) => {
    return async (...args: any[]): Promise<void> => {
      const opts = program.opts<GlobalOptions>();
      const ctx = await getCtx(opts);
      exitCode = await fn(ctx, ...args);
    };
  };

  // Propagate the global --offline flag to the environment so every command
  // (and the runtime dispatcher) honours it without threading opts manually.
  program.hook("preAction", () => {
    const opts = program.opts<GlobalOptions>();
    if (opts.offline) process.env.CODER_OFFLINE = "1";
  });

  // Bare invocation: `coder`, `coder --offline` (status panel), `coder --pet`.
  // Unknown commands reach the root action too, so reject them explicitly to
  // preserve the exit-code-2 contract.
  program.action(
    wrap(async (ctx, opts: GlobalOptions, cmd: Command) => {
      const positional = cmd?.args ?? [];
      if (positional.length > 0) {
        process.stderr.write(`${APP_DISPLAY_NAME}: unknown command '${positional[0]}'. Run \`coder help\` for usage.\n`);
        return EXIT.USAGE;
      }
      if (opts.pet || opts.autonomous) return petCommand(ctx, { autonomous: opts.autonomous });
      if (opts.offline) return statusCommand(ctx, { offline: true });
      process.stdout.write(`${renderHelp(ctx.theme)}\n`);
      return EXIT.OK;
    }),
  );

  // ------------------------------------------------------------- chat
  program
    .command("chat")
    .description("Start an interactive chat session (--safe/--balanced/--full-auto enable agent mode)")
    .option("--no-stream", "disable streaming responses")
    .option("--repl", "force the readline REPL UI (no Ink TUI)")
    .option("--safe", "agent mode: read-only tools")
    .option("--balanced", "agent mode: writes, patches, git commits")
    .option("--full-auto", "agent mode: everything incl. shell execution")
    .action(wrap(async (ctx, opts: { stream: boolean; repl: boolean; safe?: boolean; balanced?: boolean; fullAuto?: boolean }) => {
      const level = opts.fullAuto ? "full-auto" : opts.balanced ? "balanced" : opts.safe ? "safe" : undefined;
      return chatCommand(ctx, { stream: opts.stream, forceRepl: opts.repl, level });
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
    .description("Push local records and keys to the backend (--flush drains the offline outbox)")
    .option("--flush", "drain the offline sync outbox")
    .action(wrap(async (ctx, opts: { flush?: boolean }) => (opts.flush ? syncFlushCommand(ctx) : syncCommand(ctx))));

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

  // ---------------------------------------------------------- workspace
  program
    .command("scan")
    .description("Scan and index the repository (symbols, dependencies, tests)")
    .option("--dir <path>", "workspace root (default: current directory)")
    .option("--refresh", "force a fresh scan")
    .option("--json", "raw JSON output")
    .option("--no-sync", "skip the backend sync")
    .action(wrap(async (ctx, opts: { dir?: string; refresh?: boolean; json?: boolean; sync: boolean }) => {
      return scanCommand(ctx, { dir: opts.dir, refresh: opts.refresh, json: opts.json, noSync: !opts.sync });
    }));

  program
    .command("search <query>")
    .description("Search the repository (content, symbols, files, dependencies, git history)")
    .option("--dir <path>", "workspace root")
    .option("--kind <kind>", "content | symbol | file | definition | references | dependencies | git", "content")
    .option("--case-sensitive", "case-sensitive match")
    .option("--limit <n>", "max results", "50")
    .option("--json", "raw JSON output")
    .action(wrap(async (ctx, query: string, opts: { dir?: string; kind?: string; caseSensitive?: boolean; limit?: string; json?: boolean }) => {
      return searchCommand(ctx, {
        query,
        dir: opts.dir,
        kind: (opts.kind ?? "content") as "content" | "symbol" | "file" | "definition" | "references" | "dependencies" | "git",
        caseSensitive: opts.caseSensitive,
        limit: Number(opts.limit ?? 50),
        json: opts.json,
      });
    }));

  program
    .command("files")
    .description("List the repository's source files")
    .option("--dir <path>", "workspace root")
    .option("--pattern <pattern>", "filter by path fragment")
    .option("--all", "include non-source files")
    .option("--limit <n>", "max entries", "200")
    .option("--json", "raw JSON output")
    .action(wrap(async (ctx, opts: { dir?: string; pattern?: string; all?: boolean; limit?: string; json?: boolean }) => {
      return filesCommand(ctx, { dir: opts.dir, pattern: opts.pattern, all: opts.all, limit: Number(opts.limit ?? 200), json: opts.json });
    }));

  program
    .command("context")
    .description("Build and print the repository context bundle")
    .option("--dir <path>", "workspace root")
    .option("--json", "raw JSON output")
    .action(wrap(async (ctx, opts: { dir?: string; json?: boolean }) => contextCommand(ctx, opts)));

  program
    .command("explain <file>")
    .description("Explain a file (symbols, imports, relations) or --symbol <name>")
    .option("--dir <path>", "workspace root")
    .option("--symbol <name>", "focus on a symbol")
    .option("--ai", "add a model-generated explanation")
    .option("--json", "raw JSON output")
    .action(wrap(async (ctx, file: string, opts: { dir?: string; symbol?: string; ai?: boolean; json?: boolean }) => {
      return explainCommand(ctx, { file, dir: opts.dir, symbol: opts.symbol, ai: opts.ai, json: opts.json });
    }));

  program
    .command("diff")
    .description("Show workspace changes (git diff, or tool-edit diffs)")
    .option("--dir <path>", "workspace root")
    .option("--staged", "git diff --cached")
    .option("--json", "raw JSON output")
    .action(wrap(async (ctx, opts: { dir?: string; staged?: boolean; json?: boolean }) => diffCommand(ctx, opts)));

  program
    .command("undo")
    .description("Undo the last tool edit (restores the original file content)")
    .option("--dir <path>", "workspace root")
    .action(wrap(async (ctx, opts: { dir?: string }) => undoCommand(ctx, opts)));

  program
    .command("redo")
    .description("Redo the last undone edit")
    .option("--dir <path>", "workspace root")
    .action(wrap(async (ctx, opts: { dir?: string }) => redoCommand(ctx, opts)));

  const checkpoints = program
    .command("checkpoints")
    .description("Manage workspace checkpoints")
    .option("--dir <path>", "workspace root")
    .action(wrap(async (ctx, opts: { dir?: string }) => checkpointsCommand(ctx, opts)));

  checkpoints
    .command("create")
    .description("Create a checkpoint of the workspace")
    .option("--name <name>", "checkpoint name")
    .action(wrap(async (ctx, opts: { name?: string }, cmd: Command) => {
      const parent = cmd.parent?.opts<{ dir?: string }>() ?? {};
      return checkpointCreateCommand(ctx, { dir: parent.dir, name: opts.name });
    }));

  checkpoints
    .command("restore <id>")
    .description("Restore the workspace from a checkpoint")
    .action(wrap(async (ctx, id: string, _opts: Record<string, never>, cmd: Command) => {
      const parent = cmd.parent?.opts<{ dir?: string }>() ?? {};
      return checkpointRestoreCommand(ctx, { id, dir: parent.dir });
    }));

  checkpoints
    .command("delete <id>")
    .description("Delete a checkpoint")
    .action(wrap(async (ctx, id: string, _opts: Record<string, never>, cmd: Command) => {
      const parent = cmd.parent?.opts<{ dir?: string }>() ?? {};
      return checkpointDeleteCommand(ctx, { id, dir: parent.dir });
    }));

  program
    .command("tools")
    .description("List the available workspace tools and their permission levels")
    .action(wrap(async (ctx) => toolsCommand(ctx)));

  program
    .command("agent <task...>")
    .description("Run an autonomous agent task on the repository (tools + model)")
    .option("--dir <path>", "workspace root")
    .option("--level <level>", "safe | balanced | full-auto", "balanced")
    .option("--provider <id>", "provider to use")
    .option("--model <id>", "model to use")
    .option("--no-sync", "do not persist patch records to the backend")
    .action(wrap(async (ctx, taskArgs: string[], opts: { dir?: string; level?: string; provider?: string; model?: string; sync: boolean }) => {
      return agentCommand(ctx, {
        task: taskArgs.join(" "),
        dir: opts.dir,
        level: (opts.level ?? "balanced") as "safe" | "balanced" | "full-auto",
        provider: opts.provider,
        model: opts.model,
        noSync: !opts.sync,
      });
    }));

  // -------------------------------------------------- Phase 4 — orchestration
  program
    .command("roles")
    .description("List the available agent roles")
    .action(wrap(async (ctx) => rolesCommand(ctx)));

  program
    .command("plan <task...>")
    .description("Plan a task using the planner role")
    .option("--dir <path>", "workspace root")
    .option("--provider <id>", "provider to use")
    .option("--model <id>", "model to use")
    .action(wrap(async (ctx, taskArgs: string[], opts: { dir?: string; provider?: string; model?: string }) => {
      return planCommand(ctx, { task: taskArgs.join(" "), dir: opts.dir, provider: opts.provider, model: opts.model });
    }));

  program
    .command("orchestrate <task...>")
    .description("Run a task through the full multi-agent pipeline")
    .option("--dir <path>", "workspace root")
    .option("--provider <id>", "provider to use")
    .option("--model <id>", "model to use")
    .action(wrap(async (ctx, taskArgs: string[], opts: { dir?: string; provider?: string; model?: string }) => {
      return orchestrateCommand(ctx, { task: taskArgs.join(" "), dir: opts.dir, provider: opts.provider, model: opts.model });
    }));

  const workflow = program
    .command("workflow")
    .description("Reusable role pipelines (list | install | run)")
    .action(wrap(async (ctx) => workflowListCommand(ctx)));

  workflow
    .command("list")
    .description("List workflows")
    .action(wrap(async (ctx) => workflowListCommand(ctx)));

  workflow
    .command("install <name>")
    .description("Install a custom workflow (steps are role ids, comma-separated)")
    .option("--steps <steps>", "comma-separated role ids", "")
    .option("--description <text>", "workflow description")
    .action(wrap(async (ctx, name: string, opts: { steps: string; description?: string }) => {
      const steps = opts.steps.split(",").map((s) => s.trim()).filter(Boolean);
      return workflowInstallCommand(ctx, { name, steps, description: opts.description });
    }));

  workflow
    .command("run <name>")
    .description("Run a workflow against a task")
    .argument("<task...>", "task description")
    .option("--dir <path>", "workspace root")
    .option("--provider <id>", "provider to use")
    .option("--model <id>", "model to use")
    .action(wrap(async (ctx, name: string, taskArgs: string[], opts: { dir?: string; provider?: string; model?: string }) => {
      return workflowRunCommand(ctx, { name, task: taskArgs.join(" "), dir: opts.dir, provider: opts.provider, model: opts.model });
    }));

  // -------------------------------------------------- Phase 4 — MCP
  const mcp = program
    .command("mcp")
    .description("Manage MCP (Model Context Protocol) servers")
    .action(wrap(async (ctx) => mcpListCommand(ctx)));

  mcp.command("list").description("List MCP servers").action(wrap(async (ctx) => mcpListCommand(ctx)));

  mcp
    .command("add <name>")
    .description("Add an MCP server")
    .option("--command <cmd>", "stdio command to launch the server")
    .option("--url <url>", "http/sse endpoint")
    .option("--transport <kind>", "stdio | http | sse")
    .action(wrap(async (ctx, name: string, opts: { command?: string; url?: string; transport?: string }) => {
      return mcpAddCommand(ctx, { name, command: opts.command, url: opts.url, transport: opts.transport });
    }));

  mcp
    .command("remove <id|name>")
    .description("Remove an MCP server")
    .action(wrap(async (ctx, id: string) => mcpRemoveCommand(ctx, id)));

  mcp
    .command("enable <id|name>")
    .description("Enable an MCP server")
    .action(wrap(async (ctx, id: string) => mcpEnableCommand(ctx, id, true)));

  mcp
    .command("disable <id|name>")
    .description("Disable an MCP server")
    .action(wrap(async (ctx, id: string) => mcpEnableCommand(ctx, id, false)));

  mcp
    .command("connect <id|name>")
    .description("Mark an MCP server as connected")
    .action(wrap(async (ctx, id: string) => mcpConnectCommand(ctx, id)));

  mcp
    .command("disconnect <id|name>")
    .description("Mark an MCP server as disconnected")
    .action(wrap(async (ctx, id: string) => mcpDisconnectCommand(ctx, id)));

  mcp
    .command("discover <id|name>")
    .description("Probe an MCP server for its tool surface")
    .action(wrap(async (ctx, id: string) => mcpDiscoverCommand(ctx, id)));

  // -------------------------------------------------- Phase 4 — extensions
  const extension = program
    .command("extension")
    .description("Manage extensions (install | remove | update | enable | list)")
    .action(wrap(async (ctx) => extensionListCommand(ctx)));

  extension.command("list").description("List extensions").action(wrap(async (ctx) => extensionListCommand(ctx)));

  extension
    .command("install <name>")
    .description("Install an extension")
    .option("--ver <ver>", "extension version", "1.0.0")
    .option("--description <text>", "description")
    .action(wrap(async (ctx, name: string, opts: { ver?: string; description?: string }) => {
      return extensionInstallCommand(ctx, { name, version: opts.ver, description: opts.description });
    }));

  extension.command("remove <id|name>").description("Remove an extension").action(wrap(async (ctx, id: string) => extensionRemoveCommand(ctx, id)));

  extension
    .command("update <id|name>")
    .description("Update an extension manifest")
    .option("--ver <ver>", "new version")
    .option("--description <text>", "new description")
    .action(wrap(async (ctx, id: string, opts: { ver?: string; description?: string }) => {
      return extensionUpdateCommand(ctx, id, { version: opts.ver, description: opts.description });
    }));

  extension.command("enable <id|name>").description("Enable an extension").action(wrap(async (ctx, id: string) => extensionEnableCommand(ctx, id, true)));

  extension.command("disable <id|name>").description("Disable an extension").action(wrap(async (ctx, id: string) => extensionEnableCommand(ctx, id, false)));

  // -------------------------------------------------- Phase 4 — skills
  const skill = program
    .command("skill")
    .description("Manage skills (list | use | show | install | create)")
    .action(wrap(async (ctx) => skillListCommand(ctx)));

  skill.command("list").description("List skills").action(wrap(async (ctx) => skillListCommand(ctx)));

  skill
    .command("show <name>")
    .description("Show a skill")
    .action(wrap(async (ctx, name: string) => skillShowCommand(ctx, name)));

  skill
    .command("install <name>")
    .description("Install a skill")
    .requiredOption("--domain <domain>", "skill domain")
    .requiredOption("--description <text>", "short description")
    .requiredOption("--system-prompt <text>", "system prompt fragment")
    .option("--tools <ids>", "comma-separated tool ids", "")
    .action(wrap(async (ctx, name: string, opts: { domain: string; description: string; systemPrompt: string; tools: string }) => {
      return skillInstallCommand(ctx, { name, domain: opts.domain, description: opts.description, systemPrompt: opts.systemPrompt, tools: opts.tools.split(",").map((s) => s.trim()).filter(Boolean) });
    }));

  skill
    .command("create <name>")
    .description("Create a custom skill (alias for install)")
    .requiredOption("--domain <domain>", "skill domain")
    .requiredOption("--description <text>", "short description")
    .requiredOption("--system-prompt <text>", "system prompt fragment")
    .option("--tools <ids>", "comma-separated tool ids", "")
    .action(wrap(async (ctx, name: string, opts: { domain: string; description: string; systemPrompt: string; tools: string }) => {
      return skillCreateCommand(ctx, { name, domain: opts.domain, description: opts.description, systemPrompt: opts.systemPrompt, tools: opts.tools.split(",").map((s) => s.trim()).filter(Boolean) });
    }));

  skill
    .command("use <name>")
    .description("Apply a skill to a task")
    .argument("<task...>", "task description")
    .option("--dir <path>", "workspace root")
    .option("--provider <id>", "provider to use")
    .option("--model <id>", "model to use")
    .action(wrap(async (ctx, name: string, taskArgs: string[], opts: { dir?: string; provider?: string; model?: string }) => {
      return skillUseCommand(ctx, { name, task: taskArgs.join(" "), dir: opts.dir, provider: opts.provider, model: opts.model });
    }));

  // -------------------------------------------------- Phase 4 — tasks
  const task = program
    .command("task")
    .description("Manage the persisted task queue (run | list | status | cancel)")
    .action(wrap(async (ctx) => taskListCommand(ctx)));

  task.command("list").description("List tasks").action(wrap(async (ctx) => taskListCommand(ctx)));

  task
    .command("run <description...>")
    .description("Enqueue a background task")
    .option("--kind <kind>", "task kind", "background")
    .action(wrap(async (ctx, descArgs: string[], opts: { kind?: string }) => {
      return taskRunCommand(ctx, { description: descArgs.join(" "), kind: opts.kind });
    }));

  task.command("status <id>").description("Show a task's status").action(wrap(async (ctx, id: string) => taskStatusCommand(ctx, id)));

  task.command("cancel <id>").description("Cancel a task").action(wrap(async (ctx, id: string) => taskCancelCommand(ctx, id)));

  // -------------------------------------------------------- Phase 5/7 — cognitive
  const cognitive = program
    .command("cognitive")
    .description("Cognitive core status")
    .action(wrap(async (ctx) => cognitiveStatusCommand(ctx)));
  cognitive.command("status").description("Show cognitive core state").action(wrap(async (ctx) => cognitiveStatusCommand(ctx)));

  program
    .command("evolve <task...>")
    .description("Run the adaptive self-improvement loop on a task")
    .option("--dir <path>", "workspace root")
    .option("--provider <id>", "provider to use")
    .option("--model <id>", "model to use")
    .action(wrap(async (ctx, taskArgs: string[], opts: { dir?: string; provider?: string; model?: string }) => {
      return evolveCommand(ctx, { task: taskArgs.join(" "), dir: opts.dir, provider: opts.provider, model: opts.model });
    }));

  program
    .command("research <topic...>")
    .description("Autonomous research engine over the repository")
    .option("--dir <path>", "workspace root")
    .option("--provider <id>", "provider to use")
    .option("--model <id>", "model to use")
    .action(wrap(async (ctx, topicArgs: string[], opts: { dir?: string; provider?: string; model?: string }) => {
      return researchCommand(ctx, { topic: topicArgs.join(" "), dir: opts.dir, provider: opts.provider, model: opts.model });
    }));

  // ------------------------------------------------------ Phase 5/7/9 — memory
  const memory = program
    .command("memory")
    .description("Scoped memory (store | recall | search)")
    .action(wrap(async (ctx) => memorySearchCommand(ctx, { query: "" })));
  memory
    .command("store <key> <value>")
    .description("Store a memory entry")
    .option("--scope <scope>", "session|project|user|global|immediate|working|long-term", "user")
    .option("--kind <kind>", "fact|episodic|semantic|procedural", "fact")
    .action(wrap(async (ctx, key: string, value: string, opts: { scope?: string; kind?: string }) => memoryStoreCommand(ctx, { key, value, scope: opts.scope, kind: opts.kind })));
  memory
    .command("recall <key>")
    .description("Recall memory entries for a key")
    .option("--scope <scope>", "scope filter")
    .action(wrap(async (ctx, key: string, opts: { scope?: string }) => memoryRecallCommand(ctx, { key, scope: opts.scope })));
  memory
    .command("search <query>")
    .description("Search memory across scopes")
    .option("--scope <scope>", "scope filter")
    .action(wrap(async (ctx, query: string, opts: { scope?: string }) => memorySearchCommand(ctx, { query, scope: opts.scope })));

  // ------------------------------------------------------- Phase 8 — knowledge & models
  const knowledge = program
    .command("knowledge")
    .description("Global knowledge graph (graph | stats | search)")
    .action(wrap(async (ctx) => knowledgeStatsCommand(ctx)));
  knowledge
    .command("graph")
    .description("Rebuild the knowledge graph from the repository index")
    .option("--dir <path>", "workspace root")
    .action(wrap(async (ctx, opts: { dir?: string }) => knowledgeGraphCommand(ctx, opts)));
  knowledge.command("stats").description("Knowledge graph statistics").action(wrap(async (ctx) => knowledgeStatsCommand(ctx)));
  knowledge.command("search <query>").description("Ranked search over the knowledge graph").action(wrap(async (ctx, q: string) => knowledgeSearchCommand(ctx, q)));

  // `model benchmark` / `model info` (alongside the existing model use|current|list)
  model
    .command("benchmark")
    .description("Benchmark model latency + cost")
    .option("--provider <id>", "provider to benchmark")
    .option("--model <id>", "single model to benchmark")
    .option("--all", "benchmark every provider")
    .option("--json", "raw JSON output")
    .action(wrap(async (ctx, opts: { provider?: string; model?: string; all?: boolean; json?: boolean }) => {
      return modelBenchmarkCommand(ctx, opts);
    }));
  model
    .command("info <model-id>")
    .description("Classify a model and estimate cost")
    .option("--json", "raw JSON output")
    .action(wrap(async (ctx, modelId: string, opts: { json?: boolean }) => modelInfoCommand(ctx, modelId, opts)));

  // ---------------------------------------------------------- Phase 6 — enterprise
  const org = program
    .command("org")
    .description("Organizations (create | list | show | member | usage | memory)")
    .action(wrap(async (ctx) => orgListCommand(ctx)));
  org
    .command("create <name>")
    .description("Create an organization")
    .option("--plan <plan>", "team | business | enterprise", "team")
    .action(wrap(async (ctx, name: string, opts: { plan?: string }) => orgCreateCommand(ctx, { name, plan: opts.plan })));
  org.command("list").description("List organizations").action(wrap(async (ctx) => orgListCommand(ctx)));
  org.command("show <id|name>").description("Show an organization").action(wrap(async (ctx, id: string) => orgShowCommand(ctx, id)));
  org
    .command("member <action> <org> <email>")
    .description("add | remove a member")
    .option("--role <role>", "owner | admin | member", "member")
    .action(wrap(async (ctx, action: string, orgId: string, email: string, opts: { role?: string }) => {
      return orgMemberCommand(ctx, { action: action as never, org: orgId, email, role: opts.role });
    }));
  org
    .command("usage <id|name>")
    .description("Show organization usage")
    .action(wrap(async (ctx, id: string) => orgUsageCommand(ctx, id)));
  org
    .command("memory <action> <org>")
    .description("store | list shared organization memory")
    .option("--key <key>", "memory key")
    .option("--value <value>", "memory value")
    .option("--scope <scope>", "memory scope", "global")
    .action(wrap(async (ctx, action: string, orgId: string, opts: { key?: string; value?: string; scope?: string }) => {
      return orgMemoryCommand(ctx, { action: action as never, org: orgId, key: opts.key, value: opts.value, scope: opts.scope });
    }));

  const workspace = program
    .command("workspace")
    .description("Cloud workspaces (create | list | start | stop | destroy)")
    .action(wrap(async (ctx) => workspaceListCommand(ctx)));
  workspace
    .command("create <name>")
    .description("Create a workspace")
    .option("--org <id|name>", "owning organization")
    .option("--environment <env>", "local | hybrid | dedicated-cloud | kubernetes | container | serverless", "local")
    .option("--region <region>", "region", "default")
    .action(wrap(async (ctx, name: string, opts: { org?: string; environment?: string; region?: string }) => {
      return workspaceCreateCommand(ctx, { name, org: opts.org, environment: opts.environment as never, region: opts.region });
    }));
  workspace.command("list").description("List workspaces").action(wrap(async (ctx) => workspaceListCommand(ctx)));
  workspace.command("start <id>").description("Start a workspace").action(wrap(async (ctx, id: string) => workspaceStartCommand(ctx, id)));
  workspace.command("stop <id>").description("Stop a workspace").action(wrap(async (ctx, id: string) => workspaceStopCommand(ctx, id)));
  workspace.command("destroy <id>").description("Destroy a workspace").action(wrap(async (ctx, id: string) => workspaceDestroyCommand(ctx, id)));

  program.command("runtime").description("Runtime monitoring (cluster, orgs, workspaces)").action(wrap(async (ctx) => runtimeCommand(ctx)));

  // ------------------------------------------------------ Phase 9 — civilization
  const civilization = program
    .command("civilization")
    .description("Autonomous engineering civilization (run | status)")
    .action(wrap(async (ctx) => civilizationStatusCommand(ctx)));
  civilization
    .command("run <goal...>")
    .description("Run a goal through the civilization")
    .option("--dir <path>", "workspace root")
    .option("--provider <id>", "provider to use")
    .option("--model <id>", "model to use")
    .action(wrap(async (ctx, goalArgs: string[], opts: { dir?: string; provider?: string; model?: string }) => {
      return civilizationRunCommand(ctx, { goal: goalArgs.join(" "), dir: opts.dir, provider: opts.provider, model: opts.model });
    }));
  civilization.command("status").description("List civilization directors").action(wrap(async (ctx) => civilizationStatusCommand(ctx)));

  // alias: `coder civ`
  program
    .command("civ")
    .description("Alias for `coder civilization run <goal>`")
    .argument("<goal...>", "civilization goal")
    .option("--dir <path>", "workspace root")
    .option("--provider <id>", "provider to use")
    .option("--model <id>", "model to use")
    .action(wrap(async (ctx, goalArgs: string[], opts: { dir?: string; provider?: string; model?: string }) => {
      return civilizationRunCommand(ctx, { goal: goalArgs.join(" "), dir: opts.dir, provider: opts.provider, model: opts.model });
    }));

  program
    .command("director <name>")
    .description("Dispatch a task to a single director")
    .argument("<task...>", "task description")
    .option("--dir <path>", "workspace root")
    .option("--provider <id>", "provider to use")
    .option("--model <id>", "model to use")
    .action(wrap(async (ctx, name: string, taskArgs: string[], opts: { dir?: string; provider?: string; model?: string }) => {
      return directorCommand(ctx, { name, task: taskArgs.join(" "), dir: opts.dir, provider: opts.provider, model: opts.model });
    }));

  // ------------------------------------------------------ Phase 5/9 — distributed
  program.command("cluster-status").description("Alias for `coder cluster status`").action(wrap(async (ctx) => clusterStatusCommand(ctx)));
  const cluster = program
    .command("cluster")
    .description("Distributed cluster status")
    .action(wrap(async (ctx) => clusterStatusCommand(ctx)));
  cluster.command("status").description("Show cluster status").action(wrap(async (ctx) => clusterStatusCommand(ctx)));

  program
    .command("worker")
    .description("Register/run a worker node")
    .option("--name <name>", "worker name")
    .option("--type <type>", "agent | tool | memory | search", "agent")
    .option("--region <region>", "region", "default")
    .option("--once", "claim and run the next queued task, then exit")
    .action(wrap(async (ctx, opts: { name?: string; type?: string; region?: string; once?: boolean }) => {
      return workerCommand(ctx, { name: opts.name, type: opts.type as never, region: opts.region, once: opts.once });
    }));

  // ---------------------------------------------------------- Phase 11 — offline-first
  program
    .command("run <task...>")
    .description("Run a task through the runtime dispatcher (--mode local|hybrid|cloud|agent|enterprise|organization|offline)")
    .option("--dir <path>", "workspace root")
    .option("--mode <mode>", "execution mode", "local")
    .option("--provider <id>", "provider to use")
    .option("--model <id>", "model to use")
    .option("--offline", "force offline (same as --mode offline)")
    .action(wrap(async (ctx, taskArgs: string[], opts: { dir?: string; mode?: string; provider?: string; model?: string; offline?: boolean }) => {
      const offline = opts.offline || opts.mode === "offline" || process.env.CODER_OFFLINE === "1";
      return runCommand(ctx, { task: taskArgs.join(" "), dir: opts.dir, mode: opts.mode, provider: opts.provider, model: opts.model, offline });
    }));

  program
    .command("pet")
    .description("Persistent pet (recovery + sync when --autonomous)")
    .option("--autonomous", "run a recovery + sync pass, then idle")
    .option("--dir <path>", "workspace root")
    .action(wrap(async (ctx, opts: { autonomous?: boolean; dir?: string }) => petCommand(ctx, opts)));

  const daemon = program
    .command("daemon")
    .description("Persistent pet daemon (start | status | stop)")
    .action(wrap(async (ctx) => daemonStatusCommand(ctx)));
  daemon
    .command("start")
    .description("Start the daemon (detached pet)")
    .option("--dir <path>", "workspace root")
    .option("--autonomous", "autonomous mode")
    .action(wrap(async (ctx, opts: { dir?: string; autonomous?: boolean }) => daemonStartCommand(ctx, opts)));
  daemon.command("status").description("Show daemon state + log tail").action(wrap(async (ctx) => daemonStatusCommand(ctx)));
  daemon.command("stop").description("Stop the daemon").action(wrap(async (ctx) => daemonStopCommand(ctx)));

  program
    .command("restore [id]")
    .description("Restore a session (make last/given session current)")
    .action(wrap(async (ctx, id: string | undefined) => restoreCommand(ctx, id)));

  program
    .command("status")
    .description("Runtime status panel")
    .option("--json", "raw JSON output")
    .action(wrap(async (ctx, opts: { json?: boolean }) => statusCommand(ctx, { json: opts.json, offline: process.env.CODER_OFFLINE === "1" })));

  const connect = program
    .command("connect")
    .description("Workspace connections (key management Mode 3)")
    .action(wrap(async (ctx) => connectCommand(ctx, { action: "list" })));
  connect
    .command("workspace <id>")
    .option("--label <label>", "connection label")
    .action(wrap(async (ctx, id: string, opts: { label?: string }) => connectCommand(ctx, { action: "workspace", id, label: opts.label })));
  connect.command("list").description("List connections").action(wrap(async (ctx) => connectCommand(ctx, { action: "list" })));
  connect.command("remove <id>").description("Remove a connection").action(wrap(async (ctx, id: string) => connectCommand(ctx, { action: "remove", id })));

  program.command("recover").description("Re-queue failed local tasks once").action(wrap(async (ctx) => recoverCommand(ctx)));

  // -------------------------------------------------- checkpoint alias (Phase 11)
  const checkpoint = program
    .command("checkpoint")
    .description("Alias for `coder checkpoints` (create | list | restore | delete)")
    .option("--dir <path>", "workspace root")
    .action(wrap(async (ctx, opts: { dir?: string }) => checkpointsCommand(ctx, opts)));
  checkpoint
    .command("create")
    .description("Create a checkpoint")
    .option("--name <name>", "checkpoint name")
    .action(wrap(async (ctx, opts: { name?: string }, cmd: Command) => {
      const parent = cmd.parent?.opts<{ dir?: string }>() ?? {};
      return checkpointCreateCommand(ctx, { dir: parent.dir, name: opts.name });
    }));
  checkpoint
    .command("list")
    .description("List checkpoints")
    .action(wrap(async (ctx, _o: Record<string, never>, cmd: Command) => {
      const parent = cmd.parent?.opts<{ dir?: string }>() ?? {};
      return checkpointsCommand(ctx, { dir: parent.dir });
    }));
  checkpoint
    .command("restore <id>")
    .action(wrap(async (ctx, id: string, _o: Record<string, never>, cmd: Command) => {
      const parent = cmd.parent?.opts<{ dir?: string }>() ?? {};
      return checkpointRestoreCommand(ctx, { id, dir: parent.dir });
    }));
  checkpoint
    .command("delete <id>")
    .action(wrap(async (ctx, id: string, _o: Record<string, never>, cmd: Command) => {
      const parent = cmd.parent?.opts<{ dir?: string }>() ?? {};
      return checkpointDeleteCommand(ctx, { id, dir: parent.dir });
    }));

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
