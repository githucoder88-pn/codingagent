/**
 * CODER — mock provider.
 *
 * A fully offline provider used by smoke tests, e2e tests and demos without
 * API keys or network access. It echoes the user's message with a small
 * canned completion so every command can be exercised end to end.
 */

import { type ChatRequest, type ChatResponse, type Model } from "../../types/index.js";
import { type Provider } from "../base/provider.interface.js";

const MODELS: Model[] = [
  { id: "mock/coder-1", provider: "mock", contextWindow: 8192, supportsTools: true, name: "Coder Mock 1" },
  { id: "mock/coder-2", provider: "mock", contextWindow: 16_384, supportsTools: true, name: "Coder Mock 2" },
  { id: "mock/echo", provider: "mock", contextWindow: 4096, supportsTools: false, name: "Echo" },
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockProvider implements Provider {
  readonly id = "mock";
  readonly name = "Mock (offline)";
  readonly defaultModel = "mock/coder-1";
  readonly requiresKey = false;

  async initialize(): Promise<void> {}

  async authenticate(_apiKey: string): Promise<boolean> {
    return true;
  }

  async listModels(): Promise<Model[]> {
    return MODELS;
  }

  private reply(request: ChatRequest): string {
    const lastUser = [...request.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    return [
      `[mock:${request.model}] This is a simulated completion.`,
      "",
      `You said: "${lastUser}"`,
      "",
      "Run `coder auth <provider>` with a real provider (openai, anthropic, gemini, openrouter) to chat with actual models.",
    ].join("\n");
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    await delay(10);
    return {
      id: `mock-${Date.now()}`,
      model: request.model,
      content: this.agentReply(request),
      usage: { inputTokens: 1, outputTokens: 1 },
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Per-role deterministic completions (Phase 4+). When the system prompt
   * carries a `CODER AGENT ROLE: <role>` marker, the mock returns a canned,
   * role-specific completion so multi-agent pipelines are fully testable
   * offline. Lower-cased, whitespace-tolerant lookup.
   */
  private roleReply(role: string, userMessage: string): string {
    const r = role.trim().toLowerCase();
    const out: Record<string, string> = {
      planner: `Plan: decompose "${userMessage}" into ordered, verifiable steps; identify risks and dependencies.`,
      researcher: `Research: survey the codebase and prior art for "${userMessage}"; surface relevant symbols, patterns and constraints.`,
      developer: `Develop: implement "${userMessage}" following existing conventions; keep changes small and testable.`,
      reviewer: `Review: audit the implementation of "${userMessage}" for correctness, style, security and regressions.`,
      tester: `Test: design and run tests covering "${userMessage}"; report pass/fail and coverage gaps.`,
      security: `Security: threat-model "${userMessage}"; flag injection, secrets, authz and dependency risks.`,
      documenter: `Document: record "${userMessage}" in docs, README and inline comments; keep examples accurate.`,
      memory: `Memory: persist key facts and lessons from "${userMessage}" for future sessions.`,
      coordinator: `Coordinate: allocate "${userMessage}" across directors and reconcile their outputs.`,
      architect: `Architect: design the system structure for "${userMessage}"; choose patterns and boundaries.`,
      engineer: `Engineer: build and integrate the components for "${userMessage}".`,
      optimizer: `Optimizer: profile and tune performance for "${userMessage}"; reduce cost and latency.`,
      evaluator: `Evaluator: score outcomes for "${userMessage}" against goals; surface trade-offs.`,
      deployment: `Deployment: package and roll out "${userMessage}"; verify health and rollback paths.`,
    };
    return out[r] ?? `Role ${role}: processed "${userMessage}".`;
  }

  /**
   * Agent-mode behavior (Phase 3): when the system prompt carries the
   * CODER TOOLS marker, the mock walks a scripted tool-use sequence so the
   * agent loop is fully testable offline. The script depends on how many
   * assistant tool-calls have already happened:
   *   scan → files → git_status → run_tests → git_commit → final text
   */
  private agentReply(request: ChatRequest): string {
    const system = request.messages.find((m) => m.role === "system")?.content ?? "";
    const roleMatch = /CODER AGENT ROLE:\s*([A-Za-z_-]+)/.exec(system);
    if (roleMatch) {
      const lastUser = [...request.messages].reverse().find((m) => m.role === "user")?.content ?? "";
      // A role step that also has the TOOLS marker still emits tool calls;
      // a plain role step emits its deterministic completion.
      if (!system.includes("CODER TOOLS")) return this.roleReply(roleMatch[1]!, lastUser);
    }
    if (!system.includes("CODER TOOLS")) return this.reply(request);

    const assistantTurns = request.messages.filter((m) => m.role === "assistant").length;
    const sequence: string[] = [
      JSON.stringify({ tool: "scan" }),
      JSON.stringify({ tool: "files", params: {} }),
      JSON.stringify({ tool: "git_status" }),
      JSON.stringify({ tool: "write_file", params: { path: "AGENT.md", content: "# Agent run\n\nAnalyzed by the CODER agent.\n" } }),
      JSON.stringify({ tool: "run_tests", params: {} }),
      JSON.stringify({ tool: "git_commit", params: { message: "chore: agent changes" } }),
      "Task complete. Analyzed the repository, added a change, ran the tests, and committed the result.",
    ];
    const step = sequence[Math.min(assistantTurns, sequence.length - 1)]!;
    return `\`\`\`json\n${step}\n\`\`\``;
  }

  async *stream(request: ChatRequest): AsyncGenerator<string> {
    const words = this.reply(request).split(" ");
    for (let i = 0; i < words.length; i += 3) {
      yield words.slice(i, i + 3).join(" ") + (i + 3 < words.length ? " " : "");
      await delay(1);
    }
  }
}
