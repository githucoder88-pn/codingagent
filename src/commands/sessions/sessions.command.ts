/**
 * CODER — `coder sessions` commands.
 *
 * Conversation history management: list, show, remove, current.
 */

import { type AppContext } from "../../core/application/application.js";
import { UsageError } from "../../core/errors/index.js";
import { renderTable } from "../../ui/components/primitives.js";

export async function sessionsListCommand(ctx: AppContext): Promise<number> {
  const { sessions, history, theme } = ctx;
  const metas = sessions.list();
  const current = history.currentId();
  if (metas.length === 0) {
    process.stdout.write(`${theme.dim}No sessions yet. Run \`coder chat\` or \`coder ask "…"\` to start one.${theme.reset}\n`);
    return 0;
  }
  const rows = metas.map((m) => [
    `${m.id}${m.id === current ? "*" : ""}`,
    m.provider,
    m.model,
    String(m.messageCount),
    m.updatedAt.slice(0, 19).replace("T", " "),
  ]);
  process.stdout.write(`${renderTable(["SESSION", "PROVIDER", "MODEL", "MSGS", "UPDATED"], rows)}\n`);
  process.stdout.write(`${theme.dim}* = current session${theme.reset}\n`);
  return 0;
}

export async function sessionsCurrentCommand(ctx: AppContext): Promise<number> {
  const { history, theme } = ctx;
  const id = history.currentId();
  if (!id) {
    process.stdout.write(`${theme.dim}No current session.${theme.reset}\n`);
    return 0;
  }
  process.stdout.write(`${id}\n`);
  return 0;
}

export async function sessionsShowCommand(ctx: AppContext, sessionId: string): Promise<number> {
  const { sessions, theme } = ctx;
  const session = sessions.load(sessionId);
  if (!session) {
    throw new UsageError(`Session "${sessionId}" not found. Run \`coder sessions list\` to see sessions.`);
  }
  const lines = [
    `${theme.bold}Session ${session.id}${theme.reset}  ${theme.dim}${session.provider}/${session.model} · created ${session.createdAt.slice(0, 19).replace("T", " ")}${theme.reset}`,
    "",
  ];
  for (const message of session.messages) {
    const label = message.role === "user" ? "You" : message.role === "assistant" ? "Coder" : message.role.toUpperCase();
    lines.push(`${theme.accent}${label}:${theme.reset} ${message.content}`);
    lines.push("");
  }
  if (session.messages.length === 0) lines.push(`${theme.dim}(no messages)${theme.reset}`);
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

export async function sessionsRemoveCommand(ctx: AppContext, sessionId: string): Promise<number> {
  const { history, theme } = ctx;
  const removed = history.remove(sessionId);
  if (!removed) {
    throw new UsageError(`Session "${sessionId}" not found. Run \`coder sessions list\` to see sessions.`);
  }
  process.stdout.write(`${theme.success}Removed session ${sessionId}.${theme.reset}\n`);
  return 0;
}
