/**
 * CODER — shutdown.
 *
 * Finalization sequence: dispose container services (closes SQLite), flush
 * and close the logger, then exit with the given code. `exit()` is mocked
 * in tests to keep them in-process.
 */

import { type AppContext, shutdownApp } from "../application/application.js";

export interface ShutdownOptions {
  exit?: (code: number) => never;
}

export async function shutdown(
  ctx: AppContext,
  code: number,
  opts: ShutdownOptions = {},
): Promise<never> {
  await shutdownApp(ctx);
  const exitFn = opts.exit ?? ((c: number) => process.exit(c)) as (code: number) => never;
  return exitFn(code);
}
