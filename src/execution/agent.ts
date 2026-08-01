/**
 * CODER — agent loop (Phase 3).
 *
 * Turns a task prompt into autonomous work: build repository context,
 * call the model with a tool-use protocol, execute the model's tool calls
 * through the scheduler, feed results back, and iterate until the model
 * answers in plain text (or the iteration budget is exhausted).
 *
 * Tool-use protocol: the model replies either with normal text (done) or
 * with a fenced JSON block:
 *
 *     ```json
 *     {"tool":"read_file","params":{"path":"src/index.ts"}}
 *     ```
 */

import { ProviderRegistry } from "../providers/registry.js";
import { type ChatMessage } from "../types/index.js";
import { renderToolSchema, getTool } from "../tools/registry.js";
import { ExecutionScheduler } from "./scheduler.js";
import { type PermissionLevel } from "../workspace/types.js";
import { ContextEngine } from "../workspace/context/engine.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";

export const AGENT_SYSTEM_MARKER = "CODER TOOLS";

const MAX_ITERATIONS = 15;

export interface AgentOptions {
  task: string;
  workspace: WorkspaceManager;
  registry: ProviderRegistry;
  providerId: string;
  model: string;
  scheduler: ExecutionScheduler;
  stream?: boolean;
  /** Extra context (e.g. previous conversation). */
  history?: ChatMessage[];
  maxIterations?: number;
  onStep?: (step: { kind: "tool" | "message" | "error"; text: string; toolId?: string }) => void;
}

export interface AgentResult {
  answer: string;
  iterations: number;
  toolCalls: number;
  finished: boolean;
}

const TOOL_PROTOCOL = `You are CODER, an autonomous coding agent working in a repository.

You have tools available. When you need to inspect or modify the repository,
reply with exactly one JSON object in a fenced code block:

\`\`\`json
{"tool":"<tool_id>","params":{...}}
\`\`\`

Available tools:
${renderToolSchema()}

Rules:
- Inspect before you modify. Read files before editing them.
- Use search tools to locate symbols and tests.
- Prefer small, verifiable changes; run tests/build when appropriate.
- When the task is complete (or when a tool result tells you it cannot be
  done), reply with a short plain-text summary. Do not emit JSON then.
- You may use memory_note to keep notes between steps.`;

function parseToolCall(text: string): { tool: string; params: Record<string, unknown> } | null {
  const fenced = /```(?:json)?\s*\n?(\{[\s\S]*?\})\s*```/.exec(text);
  const candidate = fenced?.[1] ?? text.trim();
  try {
    const parsed = JSON.parse(candidate) as { tool?: string; params?: Record<string, unknown> };
    if (!parsed.tool || typeof parsed.tool !== "string") return null;
    if (!getTool(parsed.tool)) return null;
    return { tool: parsed.tool, params: parsed.params ?? {} };
  } catch {
    return null;
  }
}

export async function runAgent(opts: AgentOptions): Promise<AgentResult> {
  const { workspace, registry, providerId, model, scheduler } = opts;
  const maxIterations = opts.maxIterations ?? MAX_ITERATIONS;

  const contextEngine: ContextEngine = workspace.context();
  const bundle = await contextEngine.build({ includeGit: true });
  const contextText = contextEngine.render(bundle);

  const messages: ChatMessage[] = [
    { role: "system", content: `${TOOL_PROTOCOL}\n\n${AGENT_SYSTEM_MARKER}\n\nRepository context:\n${contextText}` },
    ...(opts.history ?? []),
    { role: "user", content: opts.task },
  ];

  let iterations = 0;
  let toolCalls = 0;

  for (;;) {
    iterations += 1;
    if (iterations > maxIterations) {
      return { answer: "Agent stopped: iteration budget exhausted.", iterations, toolCalls, finished: false };
    }

    const response = await registry.chat(providerId, { model, messages, stream: false });
    const text = response.content.trim();

    const toolCall = parseToolCall(text);
    if (!toolCall) {
      opts.onStep?.({ kind: "message", text });
      return { answer: text, iterations, toolCalls, finished: true };
    }

    toolCalls += 1;
    opts.onStep?.({ kind: "tool", text: `${toolCall.tool} ${JSON.stringify(toolCall.params)}`, toolId: toolCall.tool });
    const result = await scheduler.execute(toolCall.tool, toolCall.params);
    if (!result.ok) {
      opts.onStep?.({ kind: "error", text: `${toolCall.tool}: ${result.error ?? "failed"}` });
    }

    const resultText = result.ok
      ? result.output.slice(0, 4000)
      : `ERROR: ${result.error ?? result.output.slice(0, 1000)}`;
    messages.push({ role: "assistant", content: text });
    messages.push({
      role: "user",
      content: `Tool result for ${toolCall.tool}:\n${resultText || "(no output)"}`,
    });
  }
}

export { parseToolCall, TOOL_PROTOCOL };
