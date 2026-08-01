/**
 * CODER — Ink chat screen (optional).
 *
 * A React/Ink TUI used when running in a real terminal with `ink` installed.
 * It renders the banner, the conversation and a live input line, with
 * streaming deltas appended to the latest assistant message. Falls back to
 * the readline REPL automatically when Ink is missing or stdin is not a TTY
 * (see chat-screen.ts).
 *
 * NOTE: `ink` and `react` are optionalDependencies; this module is only
 * imported dynamically, so a broken Ink installation never breaks the CLI.
 */

import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { type AppContext } from "../../core/application/application.js";
import { ChatController, type ChatView } from "./chat-controller.js";

interface ChatLine {
  kind: "user" | "assistant" | "system" | "error";
  text: string;
  streaming?: boolean;
}

interface InkStore {
  lines: ChatLine[];
  input: string;
  status: string | null;
  onInput: (line: string) => void;
  onExit: () => void;
  setInput: (v: string) => void;
}

function InkChatComponent(props: { store: InkStore; theme: AppContext["theme"] }) {
  const { store, theme } = props;
  const { exit } = useApp();

  const submit = (): void => {
    const line = store.input.trim();
    store.setInput("");
    if (line) store.onInput(line);
  };

  useInput((raw, key) => {
    // Real terminals deliver one keypress per event (key.return etc.).
    // Piped/scripted input arrives as one raw chunk (e.g. "hi\n"), which Ink
    // hands over as a multi-character string — process it character by
    // character so Enter still submits and EOF still exits.
    if (key.return) {
      submit();
      return;
    }
    if (key.backspace) {
      store.setInput(store.input.slice(0, -1));
      return;
    }
    if (key.escape || (key.ctrl && raw === "c")) {
      store.onExit();
      exit();
      return;
    }
    if (key.ctrl && raw === "d") {
      // Ctrl+D / EOF (piped input) — leave the chat.
      store.onExit();
      exit();
      return;
    }
    for (const c of raw) {
      if (c === "\n" || c === "\r") {
        submit();
      } else if (c === "\b" || c === "\x7f") {
        store.setInput(store.input.slice(0, -1));
      } else if (c === "\u0004") {
        // Raw EOT byte — same as Ctrl+D.
        store.onExit();
        exit();
        return;
      } else {
        store.setInput(store.input + c);
      }
    }
  });

  return (
    <Box flexDirection="column">
      {store.lines.map((line, i) => (
        <Box key={i} flexDirection="column">
          <Text color={line.kind === "user" ? "cyan" : line.kind === "error" ? "red" : line.kind === "system" ? "gray" : "white"}>
            {line.kind === "system" ? "" : `${line.kind === "user" ? "You" : line.kind === "error" ? "Error" : "Coder"}: `}
            {line.text}
            {line.streaming ? "▌" : ""}
          </Text>
        </Box>
      ))}
      {store.status !== null && <Text color="yellow">{store.status}</Text>}
      <Text color="cyan">&gt; {store.input}</Text>
    </Box>
  );
}

export class InkChatView implements ChatView {
  private readonly store: InkStore;
  private readonly listeners = new Set<() => void>();
  private inputResolver: ((line: string | null) => void) | null = null;
  private readonly queue: string[] = [];
  private closed = false;

  constructor(
    private readonly ctx: AppContext,
    private readonly controller: ChatController,
  ) {
    this.store = {
      lines: [],
      input: "",
      status: null,
      onInput: (line) => this.handleInput(line),
      onExit: () => this.handleExit(),
      setInput: (v) => {
        this.store.input = v;
        this.emit();
      },
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** React hook-compatible subscription (used by the renderer entry). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): InkStore {
    return this.store;
  }

  print(text: string): void {
    this.store.lines.push({ kind: "system", text });
    this.emit();
  }

  status(text: string): void {
    this.store.status = text;
    this.emit();
  }

  statusDone(final?: string): void {
    this.store.status = null;
    if (final) this.store.lines.push({ kind: "system", text: final });
    this.emit();
  }

  delta(text: string): void {
    const last = this.store.lines[this.store.lines.length - 1];
    if (last && last.kind === "assistant" && last.streaming) {
      last.text += text;
    } else {
      this.store.lines.push({ kind: "assistant", text, streaming: true });
    }
    this.emit();
  }

  error(message: string): void {
    this.store.lines.push({ kind: "error", text: message });
    this.emit();
  }

  banner(provider: string, model: string, sessionId: string): void {
    this.store.lines.push({
      kind: "system",
      text: `CODER — Provider: ${provider} | Model: ${model} | Session: ${sessionId}   (/help for commands)`,
    });
    this.emit();
  }

  input(): Promise<string | null> {
    if (this.closed) {
      return Promise.resolve(this.queue.shift() ?? null);
    }
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.inputResolver = resolve;
    });
  }

  close(): void {
    this.closed = true;
    if (this.inputResolver) {
      this.inputResolver(null);
      this.inputResolver = null;
    }
  }

  private handleInput(line: string): void {
    this.store.lines.push({ kind: "user", text: line });
    this.store.input = "";
    this.emit();
    // Deliver to a pending input() wait, or queue for the next one (lines
    // typed while a turn is streaming must not be dropped).
    if (this.inputResolver) {
      const resolver = this.inputResolver;
      this.inputResolver = null;
      resolver(line);
    } else {
      this.queue.push(line);
    }
  }

  private handleExit(): void {
    if (this.inputResolver) {
      const resolver = this.inputResolver;
      this.inputResolver = null;
      resolver(null);
    }
  }
}

/** Render the Ink TUI. Resolves when the user exits. */
export async function renderInkChat(
  ctx: AppContext,
  opts?: { stream?: boolean; onTurnComplete?: (info: { session: import("../../types/index.js").Session; streamed: boolean; durationMs: number }) => void },
): Promise<void> {
  const { default: ReactDefault } = await import("react");
  const ink = await import("ink");
  const { ChatController } = await import("./chat-controller.js");

  const controller = new ChatController(ctx, { stream: opts?.stream, onTurnComplete: opts?.onTurnComplete });
  const view = new InkChatView(ctx, controller);

  const App: React.FC = () => {
    const [, force] = useState(0);
    useEffect(() => view.subscribe(() => force((n) => n + 1)), []);
    return ReactDefault.createElement(InkChatComponent, { store: view.getSnapshot(), theme: ctx.theme });
  };

  await new Promise<void>((resolve) => {
    const { unmount } = ink.render(ReactDefault.createElement(App));
    void (async () => {
      await controller.run(view);
      unmount();
      resolve();
    })();
  });
}
