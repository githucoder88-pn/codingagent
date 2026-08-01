/**
 * CODER — CLI entry point.
 *
 * Parses argv, bootstraps the application, runs the requested command and
 * exits with a stable exit code. Errors are mapped through the CoderError
 * hierarchy (see src/core/errors).
 */

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { CommanderError } from "commander";
import { buildProgram, type GlobalOptions, EXIT } from "./commands/index.js";
import { bootstrap } from "./core/lifecycle/bootstrap.js";
import { suppressExperimentalWarnings } from "./utils/warnings.js";

// Silence Node's "SQLite is an experimental feature" warning before anything
// loads node:sqlite (see utils/warnings.ts).
suppressExperimentalWarnings();
import { shutdownApp, type AppContext } from "./core/application/application.js";
import { toCoderError } from "./core/errors/index.js";
import { APP_DISPLAY_NAME } from "./core/constants/index.js";

/**
 * Run the CLI and return the exit code without exiting the process (used by
 * the `coder` binary and by in-process tests).
 */
export async function runCli(
  argv: string[] = process.argv,
  opts: { exit?: boolean } = {},
): Promise<number> {
  let ctx: AppContext | null = null;
  const program = buildProgram(async (globalOpts: GlobalOptions) => {
    const { ctx: appCtx } = await bootstrap({ consoleDebug: globalOpts.debug });
    ctx = appCtx;
    return appCtx;
  });
  program.exitOverride();

  let code: number;
  try {
    await program.parseAsync(argv);
    code = (program as unknown as { _coderExitCode(): number })._coderExitCode();
  } catch (err) {
    code = handleCliError(err);
  }

  if (ctx) {
    try {
      await shutdownApp(ctx);
    } catch {
      /* best effort */
    }
  }
  if (opts.exit !== false) process.exitCode = code;
  return code;
}

function handleCliError(err: unknown): number {
  if (err instanceof CommanderError) {
    // `--help` / `--version` are "errors" under exitOverride but mean success.
    if (["commander.helpDisplayed", "commander.help", "commander.version"].includes(err.code)) {
      return err.exitCode ?? EXIT.OK;
    }
    // Commander already printed the message (and help, via showHelpAfterError).
    return err.code === "commander.unknownCommand" ? EXIT.USAGE : (err.exitCode ?? EXIT.USAGE);
  }
  const coderErr = toCoderError(err);
  process.stderr.write(`${APP_DISPLAY_NAME}: ${coderErr.message}\n`);
  return coderErr.exitCode;
}

/** Real entry point for the `coder` binary. */
export async function main(): Promise<void> {
  // Piping output into `head`/`less` closes stdout early — that is normal
  // CLI usage, not an error. Exit quietly instead of crashing with EPIPE.
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EPIPE") process.exit(0);
      throw err;
    });
  }
  const code = await runCli(process.argv, { exit: false });
  process.exitCode = code;
}

// Direct execution: `coder …` / `node dist/cli.js …`
// Compare against the resolved real path so symlinked global installs
// (`/usr/local/bin/coder` → `../lib/node_modules/coder/dist/cli.js`) work.
if (process.argv[1]) {
  let entry = process.argv[1];
  try {
    entry = realpathSync(entry);
  } catch {
    /* keep argv path */
  }
  if (import.meta.url === pathToFileURL(entry).href) {
    void main();
  }
}
