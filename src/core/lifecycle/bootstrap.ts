/**
 * CODER — bootstrap.
 *
 * Startup sequence used by both the CLI and programmatic entry points.
 * Kept separate from the command layer so it can be reused by tests.
 */

import { createApp, type CreateAppOptions, type AppContext } from "../application/application.js";
import { VERSION, PHASE, APP_DISPLAY_NAME } from "../constants/index.js";

export interface BootstrapResult {
  ctx: AppContext;
  startedAt: number;
}

export async function bootstrap(options: CreateAppOptions = {}): Promise<BootstrapResult> {
  const startedAt = Date.now();
  const ctx = await createApp(options);
  ctx.logger.debug(
    `${APP_DISPLAY_NAME} v${VERSION} (${PHASE}) booted in ${Date.now() - startedAt} ms`,
  );
  return { ctx, startedAt };
}
