/**
 * CODER — chat screen dispatcher.
 *
 * Picks the best UI for `coder chat`:
 *   - Ink TUI when stdin/stdout are real terminals and Ink loads,
 *   - readline REPL otherwise (pipes, CI, minimal terminals).
 */

import { isTty } from "../../utils/tty.js";
import { type AppContext } from "../../core/application/application.js";
import { runReplChat } from "./repl-chat.js";

export interface ChatScreenOptions {
  stream?: boolean;
  /** Force the readline REPL even on a TTY (tests). */
  forceRepl?: boolean;
  /** Called after each completed turn (recording/sync hook). */
  onTurnComplete?: (info: { session: import("../../types/index.js").Session; streamed: boolean; durationMs: number }) => void;
}

export async function runChatScreen(ctx: AppContext, opts: ChatScreenOptions = {}): Promise<void> {
  if (!opts.forceRepl && isTty(process.stdin) && isTty(process.stdout)) {
    try {
      const { renderInkChat } = await import("./ink-chat.js");
      await renderInkChat(ctx, { stream: opts.stream, onTurnComplete: opts.onTurnComplete });
      return;
    } catch (err) {
      ctx.logger.warn(`Ink UI unavailable (${(err as Error).message}); using the standard REPL.`);
    }
  }
  await runReplChat(ctx, { stream: opts.stream, onTurnComplete: opts.onTurnComplete });
}
