/**
 * CODER — readline chat view.
 *
 * The default interactive chat UI. Works on any terminal (including pipes
 * and CI) and is the fallback when Ink cannot be loaded. Uses a persistent
 * line queue so piped input is never dropped while an async turn runs.
 */

import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { Spinner, renderBanner } from "../components/primitives.js";
import { type AppContext } from "../../core/application/application.js";
import { type ChatView } from "./chat-controller.js";

export class ReplChatView implements ChatView {
  private readonly rl = createInterface({
    input: stdin,
    output: stdout,
    terminal: stdin.isTTY === true && stdout.isTTY === true,
  });
  private readonly spinner: Spinner;
  private readonly queue: string[] = [];
  private readonly pending: Array<(line: string | null) => void> = [];
  private promptActive = false;
  private atLineStart = true;
  private closed = false;

  constructor(private readonly ctx: AppContext) {
    this.spinner = new Spinner(stdout);
    this.rl.on("line", (line) => {
      this.promptActive = false;
      this.atLineStart = true;
      const resolver = this.pending.shift();
      if (resolver) resolver(line);
      else this.queue.push(line);
    });
    this.rl.on("close", () => {
      this.closed = true;
      const resolver = this.pending.shift();
      if (resolver) resolver(null);
    });
  }

  print(text: string): void {
    this.clearPromptLine();
    if (!this.atLineStart) stdout.write("\n");
    stdout.write(`${text}\n`);
    this.atLineStart = true;
  }

  status(text: string): void {
    if (!this.atLineStart) {
      stdout.write("\n");
      this.atLineStart = true;
    }
    this.spinner.start(text);
  }

  statusDone(final?: string): void {
    if (this.spinner.running) {
      this.spinner.stop(final);
      if (final) this.atLineStart = true;
      return;
    }
    if (final) {
      this.clearPromptLine();
      stdout.write(`${final}\n`);
      this.atLineStart = true;
    }
  }

  delta(text: string): void {
    this.clearPromptLine();
    stdout.write(text);
    this.atLineStart = false;
  }

  error(message: string): void {
    this.clearPromptLine();
    if (!this.atLineStart) stdout.write("\n");
    stdout.write(`${this.ctx.theme.error}✗ ${message}${this.ctx.theme.reset}\n`);
    this.atLineStart = true;
  }

  banner(provider: string, model: string, sessionId: string): void {
    const { theme } = this.ctx;
    const box = renderBanner(
      "CODER",
      [
        { label: "Provider", value: provider },
        { label: "Model", value: model },
        { label: "Session", value: sessionId },
      ],
      theme,
      { divider: true },
    );
    this.print(box);
    this.print("Type a message, or /help for commands.");
  }

  input(): Promise<string | null> {
    if (this.closed) {
      const queued = this.queue.shift();
      return Promise.resolve(queued ?? null);
    }
    const queued = this.queue.shift();
    if (queued !== undefined) {
      this.prompt();
      return Promise.resolve(queued);
    }
    return new Promise((resolve) => {
      this.pending.push(resolve);
      this.prompt();
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.spinner.stop();
    this.rl.close();
    for (const resolver of this.pending.splice(0)) resolver(null);
  }

  private prompt(): void {
    if (this.closed) return;
    if (!this.atLineStart) {
      stdout.write("\n");
      this.atLineStart = true;
    }
    this.promptActive = true;
    this.rl.setPrompt(`${this.ctx.theme.accent}>${this.ctx.theme.reset} `);
    this.rl.prompt();
  }

  private clearPromptLine(): void {
    if (this.promptActive) {
      stdout.write("\r\u001b[K");
      this.promptActive = false;
    }
  }
}

/** Run the REPL chat (used when Ink is unavailable or stdin is piped). */
export async function runReplChat(ctx: AppContext, opts?: { stream?: boolean }): Promise<void> {
  const view = new ReplChatView(ctx);
  const { runChat } = await import("./chat-controller.js");
  await runChat(ctx, { view, stream: opts?.stream });
  ctx.logger.info("Chat exited.");
  if (process.stdout.isTTY) {
    process.stdout.write(`${ctx.theme.dim}(chat closed)${ctx.theme.reset}\n`);
  }
}
