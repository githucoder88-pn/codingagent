/**
 * CODER — cognitive core (Phase 5 / 7).
 *
 * A set of cooperating engines that give CODER adaptive intelligence:
 *
 *   planning · reasoning · reflection · learning · world-model · memory ·
 *   evaluation · adaptation · prediction · optimization
 *
 * Engines operate over the provider registry (deterministic with the mock
 * provider via role markers) and a persisted cognitive state document at
 * ~/.coder/cognitive/state.json. `CognitiveCore` wires the engines together
 * and powers `coder cognitive status`, `coder evolve` and `coder research`.
 */

import { join } from "node:path";
import { coderHome } from "../utils/paths.js";
import { JsonStore, nowIso } from "../runtime/store.js";
import { type ProviderRegistry } from "../providers/registry.js";
import { type ChatMessage } from "../types/index.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { getAgentRole } from "../orchestration/roles.js";

export interface CognitiveState {
  riskThreshold: number; // 0..1, lower = more autonomous
  stepWeights: Record<string, number>; // role id → weight 0..1
  reflections: Array<{ at: string; outcome: "success" | "failure"; summary: string }>;
  lessons: string[];
  predictions: Array<{ at: string; task: string; confidence: number; correct?: boolean }>;
  worldModel: { lastRoot?: string; entities: number; updatedAt?: string };
}

const FILE = () => join(coderHome(), "cognitive", "state.json");

const DEFAULT_STATE: CognitiveState = {
  riskThreshold: 0.5,
  stepWeights: { planner: 1, researcher: 1, developer: 1, tester: 1, reviewer: 1, security: 0.8, documenter: 0.6 },
  reflections: [],
  lessons: [],
  predictions: [],
  worldModel: { entities: 0 },
};

export class CognitiveCore {
  readonly state: JsonStore<CognitiveState>;

  constructor() {
    this.state = new JsonStore<CognitiveState>(FILE(), structuredClone(DEFAULT_STATE));
  }

  snapshot(): CognitiveState {
    return this.state.read();
  }

  // ---- engines ---------------------------------------------------------

  /** Plan a task into ordered steps via the planner role. */
  async plan(registry: ProviderRegistry, providerId: string, model: string, task: string): Promise<string[]> {
    const text = await this.ask(registry, providerId, model, "planner", task);
    return text
      .split("\n")
      .map((l) => l.replace(/^[\s-*\d.)]+/, "").trim())
      .filter((l) => l.length > 0);
  }

  /** Chain-of-thought reasoning over a question via the researcher role. */
  async reason(registry: ProviderRegistry, providerId: string, model: string, question: string): Promise<string> {
    return this.ask(registry, providerId, model, "researcher", question);
  }

  /** Evaluate a result against a goal (0..1 score + notes). */
  async evaluate(registry: ProviderRegistry, providerId: string, model: string, goal: string, result: string): Promise<{ score: number; notes: string }> {
    const text = await this.ask(registry, providerId, model, "evaluator", `Goal: ${goal}\nResult: ${result}`);
    const scoreMatch = /([0-9](?:\.\d+)?)/.exec(text);
    const score = scoreMatch ? Math.min(1, Math.max(0, Number(scoreMatch[1]))) : 0.7;
    return { score, notes: text };
  }

  /** Reflect on an outcome and persist a marker + lessons. */
  reflect(outcome: "success" | "failure", summary: string, lessons: string[] = []): void {
    this.state.update((s) => {
      s.reflections.unshift({ at: nowIso(), outcome, summary: summary.slice(0, 200) });
      s.reflections = s.reflections.slice(0, 100);
      for (const l of lessons) if (!s.lessons.includes(l)) s.lessons.unshift(l);
      s.lessons = s.lessons.slice(0, 50);
    });
    this.adapt(outcome);
  }

  /** Adjust riskThreshold + step weights from an outcome (learning loop). */
  adapt(outcome: "success" | "failure"): void {
    this.state.update((s) => {
      const delta = outcome === "success" ? -0.02 : 0.05;
      s.riskThreshold = Math.min(0.9, Math.max(0.1, s.riskThreshold + delta));
    });
  }

  /** Predict the confidence (0..1) that a task will succeed, from history. */
  predict(task: string): number {
    const s = this.snapshot();
    if (s.reflections.length === 0) return 0.5;
    const wins = s.reflections.filter((r) => r.outcome === "success").length;
    const base = wins / s.reflections.length;
    const keywordBonus = s.lessons.some((l) => task.toLowerCase().split(/\W+/).some((w) => w && l.toLowerCase().includes(w))) ? 0.05 : 0;
    return Math.min(0.99, Math.max(0.01, base + keywordBonus));
  }

  recordPrediction(task: string, confidence: number): void {
    this.state.update((s) => s.predictions.unshift({ at: nowIso(), task: task.slice(0, 120), confidence }));
  }

  settlePrediction(correct: boolean): void {
    this.state.update((s) => {
      const last = s.predictions.find((p) => p.correct === undefined);
      if (last) last.correct = correct;
    });
  }

  /** Update the world-model from a scanned workspace. */
  updateWorldModel(workspace: WorkspaceManager): void {
    const idx = workspace.indexOrNull;
    if (!idx) return;
    const entities = idx.files.reduce((n, f) => n + f.symbols.length, 0);
    this.state.update((s) => {
      s.worldModel = { lastRoot: idx.root, entities, updatedAt: nowIso() };
    });
  }

  /** Suggest a weight tuning that favours steps with better history. */
  optimize(): { role: string; from: number; to: number }[] {
    const s = this.snapshot();
    const changes: { role: string; from: number; to: number }[] = [];
    for (const [role, w] of Object.entries(s.stepWeights)) {
      const wins = s.reflections.filter((r) => r.outcome === "success" && r.summary.toLowerCase().includes(role)).length;
      const to = Math.min(1, Math.max(0.2, w + (wins > 0 ? 0.05 : 0)));
      changes.push({ role, from: w, to });
    }
    return changes;
  }

  // ---- shared ask ------------------------------------------------------

  private async ask(registry: ProviderRegistry, providerId: string, model: string, roleId: string, prompt: string): Promise<string> {
    const role = getAgentRole(roleId)!;
    const messages: ChatMessage[] = [
      { role: "system", content: `${role.systemPrompt}\n\nCODER AGENT ROLE: ${role.id}` },
      { role: "user", content: prompt },
    ];
    const res = await registry.chat(providerId, { model, messages, stream: false });
    return res.content.trim();
  }
}

/** Singleton accessor (state is file-backed, so one instance is fine). */
let _core: CognitiveCore | null = null;
export function cognitive(): CognitiveCore {
  if (!_core) _core = new CognitiveCore();
  return _core;
}
