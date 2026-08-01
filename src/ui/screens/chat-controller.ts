/**
 * CODER — chat controller.
 *
 * UI-agnostic interactive chat logic: owns the session, applies slash
 * commands, sends turns (streaming or not) and persists everything. Both
 * the readline REPL and the optional Ink TUI drive this controller.
 */

import { type AppContext } from "../../core/application/application.js";
import { type Session } from "../../types/index.js";
import { knownModelInfo } from "../../providers/known-models.js";
import { estimateTokens } from "../../utils/format.js";
import { CoderError } from "../../core/errors/index.js";
import { WorkspaceManager } from "../../workspace/workspace-manager.js";
import { ExecutionScheduler } from "../../execution/scheduler.js";
import { getTool } from "../../tools/registry.js";
import { runAgent } from "../../execution/agent.js";
import { type PermissionLevel } from "../../workspace/types.js";

/** View contract implemented by the REPL and Ink UIs. */
export interface ChatView {
  /** Print a plain line of output. */
  print(text: string): void;
  /** Show a transient status (spinner) line. */
  status(text: string): void;
  /** Clear the status line; optionally print a final status text. */
  statusDone(final?: string): void;
  /** Stream a content delta to the user. */
  delta(text: string): void;
  /** Print an error line. */
  error(message: string): void;
  /** Print the startup banner. */
  banner(provider: string, model: string, sessionId: string): void;
  /** Wait for the next user input line (null = EOF / exit requested). */
  input(): Promise<string | null>;
  /** Finalize the view. */
  close(): void;
}

const SLASH_HELP = [
  "/help            — show this help",
  "/exit, /quit     — leave the chat",
  "/clear           — wipe this session's messages",
  "/new             — start a fresh session",
  "/model <id>      — switch model (persisted)",
  "/provider <id>   — switch provider (persisted)",
  "/sessions        — show the current session id",
  "/files           — list repository files",
  "/search <q>      — search the repository (content)",
  "/context         — show the repository context bundle",
  "/git             — git status",
  "/diff            — show workspace changes",
  "/undo            — undo the last tool edit",
  "/redo            — redo the last undone edit",
  "/checkpoints     — list checkpoints",
  "/explain <file>  — explain a file",
].join("\n");

export interface ChatRunOptions {
  /** Force non-streaming turns (overrides settings). */
  stream?: boolean;
  onTurnComplete?: (info: { session: Session; streamed: boolean; durationMs: number }) => void;
  /** Permission level for workspace tools (enables agent mode). */
  permission?: PermissionLevel;
}

export class ChatController {
  private session: Session;
  private readonly stream: boolean;

  constructor(
    private readonly ctx: AppContext,
    private readonly opts: ChatRunOptions = {},
  ) {
    const settings = ctx.settings();
    this.stream = opts.stream ?? settings.stream;
    const { provider, model } = ctx.registry.resolve(settings.provider, settings.model);
    this.session = ctx.history.getOrCreateCurrent(provider.id, model);
  }

  get currentSession(): Session {
    return this.session;
  }

  async run(view: ChatView): Promise<void> {
    const { provider, model } = this.session;
    view.banner(provider, model, this.session.id);
    this.ctx.logger.info(`Chat started: session=${this.session.id} provider=${provider} model=${model}`);

    for (;;) {
      const line = await view.input();
      if (line === null) break;
      const trimmed = line.trim();
      if (trimmed === "") continue;
      if (trimmed.startsWith("/")) {
        const keepGoing = await this.slashCommand(view, trimmed);
        if (!keepGoing) break;
        continue;
      }
      // Agent mode: when a permission level is set, ordinary messages run
      // through the autonomous tool loop.
      if (this.opts.permission && this.hasWorkspace()) {
        await this.agentTurn(view, trimmed);
        continue;
      }
      await this.turn(view, trimmed);
    }
    view.close();
  }

  private hasWorkspace(): boolean {
    return WorkspaceManager.isWorkspace(process.cwd());
  }

  /** Run a message through the agent loop with the workspace tools. */
  private async agentTurn(view: ChatView, task: string): Promise<void> {
    const root = process.cwd();
    try {
      view.status("Agent thinking…");
      const workspace = new WorkspaceManager({ root });
      await workspace.ensureIndex();
      const scheduler = new ExecutionScheduler({
        cwd: root,
        level: this.opts.permission!,
        interactive: process.stdin.isTTY === true,
        log: (msg) => this.ctx.logger.debug(msg),
      });
      const result = await runAgent({
        task,
        workspace,
        registry: this.ctx.registry,
        providerId: this.session.provider,
        model: this.session.model,
        scheduler,
        onStep: (step) => {
          if (step.kind === "tool") {
            view.print(`${this.ctx.theme.accent}→ ${step.text.slice(0, 160)}${this.ctx.theme.reset}`);
          } else if (step.kind === "error") {
            view.print(`${this.ctx.theme.warning}⚠ ${step.text.slice(0, 200)}${this.ctx.theme.reset}`);
          }
        },
      });
      view.statusDone();
      view.print(`${this.ctx.theme.bold}Agent:${this.ctx.theme.reset} ${result.answer}`);
      if (result.answer.trim() !== "") {
        this.session = this.ctx.sessions.addMessage(this.session, {
          role: "assistant",
          content: `${task}\n\n[agent] ${result.answer}`,
        });
      }
    } catch (err) {
      view.statusDone();
      view.error((err as Error).message);
    }
  }

  /** Handle one user turn (persist + stream + reply). */
  async turn(view: ChatView, content: string): Promise<void> {
    this.session = this.ctx.sessions.addMessage(this.session, { role: "user", content });

    const budget = await this.contextBudget();
    const messages = this.ctx.memory.trimToBudget(this.session.messages, {
      budgetTokens: budget > 0 ? Math.floor(budget * 0.7) : 0,
    });

    const startedAt = Date.now();
    let streamed = false;
    try {
      view.status("Thinking…");
      const request = { model: this.session.model, messages };
      let reply = "";

      if (this.stream) {
        for await (const delta of this.ctx.registry.stream(this.session.provider, request)) {
          if (!streamed) {
            streamed = true;
            view.statusDone();
          }
          reply += delta;
          view.delta(delta);
        }
        view.statusDone();
      } else {
        const response = await this.ctx.registry.chat(this.session.provider, request);
        reply = response.content;
        view.statusDone();
        if (reply) view.print(reply);
      }

      if (reply.trim() !== "") {
        this.session = this.ctx.sessions.addMessage(this.session, { role: "assistant", content: reply });
      }
      const durationMs = Date.now() - startedAt;
      this.ctx.logger.info(
        `Turn complete: session=${this.session.id} streamed=${streamed} durationMs=${durationMs} tokens~=${estimateTokens(reply)}`,
      );
      this.opts.onTurnComplete?.({ session: this.session, streamed, durationMs });
    } catch (err) {
      view.statusDone();
      const message = err instanceof CoderError ? err.message : (err as Error).message;
      view.error(message);
      this.ctx.logger.error(`Turn failed: ${message}`);
      // Revert the user message so a retry does not duplicate it.
      this.session = {
        ...this.session,
        messages: this.session.messages.slice(0, -1),
      };
      this.ctx.sessions.save(this.session);
    }
  }

  private async slashCommand(view: ChatView, line: string): Promise<boolean> {
    const [command, ...rest] = line.slice(1).trim().split(/\s+/);
    switch (command) {
      case "help":
        view.print(SLASH_HELP);
        return true;
      case "exit":
      case "quit":
        return false;
      case "clear": {
        this.session = this.ctx.sessions.clearMessages(this.session);
        view.print("Session cleared.");
        return true;
      }
      case "new": {
        const settings = this.ctx.settings();
        const { provider, model } = this.ctx.registry.resolve(settings.provider, settings.model);
        this.session = this.ctx.history.newSession(provider.id, model);
        view.banner(provider.id, model, this.session.id);
        return true;
      }
      case "model": {
        const id = rest.join(" ").trim();
        if (!id) {
          view.print(`Current model: ${this.session.model}`);
          return true;
        }
        this.session = { ...this.session, model: id };
        this.ctx.sessions.save(this.session);
        this.ctx.config.set("model", id);
        view.print(`Model set to ${id}.`);
        return true;
      }
      case "provider": {
        const id = rest.join(" ").trim();
        if (!id) {
          view.print(`Current provider: ${this.session.provider}`);
          return true;
        }
        if (!this.ctx.registry.has(id)) {
          view.error(`Unknown provider "${id}".`);
          return true;
        }
        const provider = this.ctx.registry.get(id);
        this.session = { ...this.session, provider: id, model: provider.defaultModel };
        this.ctx.sessions.save(this.session);
        this.ctx.config.set("provider", id);
        view.print(`Provider set to ${provider.name} (model ${provider.defaultModel}).`);
        return true;
      }
      case "sessions":
        view.print(
          `Current session: ${this.session.id} (${this.session.messages.length} messages, ${this.session.provider}/${this.session.model})`,
        );
        return true;
      // ------------------------------------------------ workspace commands
      case "files":
      case "search":
      case "context":
      case "git":
      case "diff":
      case "undo":
      case "redo":
      case "checkpoints":
      case "explain": {
        return this.workspaceSlash(view, command, rest.join(" "));
      }
      default:
        view.error(`Unknown command "/${command}". Type /help for available commands.`);
        return true;
    }
  }

  /** Phase 3 workspace slash commands (run tools directly). */
  private async workspaceSlash(view: ChatView, command: string, arg: string): Promise<boolean> {
    const root = process.cwd();
    if (!this.hasWorkspace()) {
      view.error("Not inside a workspace directory.");
      return true;
    }
    try {
      const workspace = new WorkspaceManager({ root });
      const scheduler = new ExecutionScheduler({
        cwd: root,
        level: this.opts.permission ?? "safe",
        interactive: process.stdin.isTTY === true,
        log: (msg) => this.ctx.logger.debug(msg),
      });
      const toolId = { files: "files", search: "search_content", context: "context", git: "git_status", diff: "git_diff", undo: "undo", redo: "redo", checkpoints: "checkpoints", explain: "read_file" }[command]!;
      const params: Record<string, unknown> = {};
      if (command === "search" && arg) params.query = arg;
      if (command === "diff") params.staged = false;
      if (command === "explain" && arg) params.path = arg;

      if (command === "checkpoints") {
        const { RollbackManager } = await import("../../execution/rollback.js");
        const list = RollbackManager.listCheckpoints(root);
        view.print(list.length ? list.map((c) => `  ${c.id} (${c.files} files)`).join("\n") : "(no checkpoints — /checkpoints via `coder checkpoints create`)");
        return true;
      }
      if (command === "undo" || command === "redo") {
        const { ExecutionLedger } = await import("../../execution/ledger.js");
        const ledger = new ExecutionLedger(root);
        const result = command === "undo" ? ledger.undo() : ledger.redo();
        view.print(result ? `  ${command} → ${result.record.tool}` : `  nothing to ${command}`);
        return true;
      }

      const tool = getTool(toolId);
      if (!tool) {
        view.error(`Tool ${toolId} unavailable.`);
        return true;
      }
      const result = await scheduler.execute(toolId, params);
      view.print(result.ok ? result.output.slice(0, 4000) : `  ${result.error}`);
      return true;
    } catch (err) {
      view.error((err as Error).message);
      return true;
    }
  }

  /** Approximate context budget from known model metadata. */
  private async contextBudget(): Promise<number> {
    const info = knownModelInfo(this.session.model);
    if (info.contextWindow > 0) return info.contextWindow;
    const cached = await this.ctx.modelCache.get(this.session.provider);
    const found = cached?.models.find((m) => m.id === this.session.model);
    return found?.contextWindow ?? 0;
  }
}

/** Convenience: run a chat session with a view and wait for completion. */
export async function runChat(
  ctx: AppContext,
  opts: { view: ChatView; stream?: boolean; onTurnComplete?: ChatRunOptions["onTurnComplete"]; permission?: PermissionLevel },
): Promise<void> {
  const controller = new ChatController(ctx, opts);
  await controller.run(opts.view);
}
