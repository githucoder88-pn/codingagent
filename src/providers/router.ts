/**
 * CODER — model intelligence (Phase 8).
 *
 * - classifyModel: chat | code | embedding | reasoning
 * - estimateCost: per-model $/1K-token rates → dollar estimate
 * - ModelRouter: cost-optimised routing to the cheapest capable model
 * - benchmark: live latency probe (`coder model benchmark`)
 */

import { type ProviderRegistry } from "./registry.js";
import { type Model } from "../types/index.js";

export type ModelClass = "chat" | "code" | "embedding" | "reasoning";

/** Heuristic classifier from the model id/name. */
export function classifyModel(id: string): ModelClass {
  const m = id.toLowerCase();
  if (m.includes("embed")) return "embedding";
  if (m.includes("o1") || m.includes("o3") || m.includes("reason") || m.includes("think") || m.includes("r1")) return "reasoning";
  if (m.includes("code") || m.includes("codestral") || m.includes("deepseek-coder") || m.includes("starcoder")) return "code";
  return "chat";
}

interface CostRate {
  inputPer1k: number;
  outputPer1k: number;
}

const COST_TABLE: Record<string, CostRate> = {
  "gpt-4o": { inputPer1k: 0.005, outputPer1k: 0.015 },
  "gpt-4o-mini": { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  "claude-3-5-sonnet": { inputPer1k: 0.003, outputPer1k: 0.015 },
  "claude-sonnet-4": { inputPer1k: 0.003, outputPer1k: 0.015 },
  "gemini-1.5-pro": { inputPer1k: 0.00125, outputPer1k: 0.005 },
  "gemini-1.5-flash": { inputPer1k: 0.000075, outputPer1k: 0.0003 },
  "llama-3.3-70b": { inputPer1k: 0.00059, outputPer1k: 0.00079 },
};

function rateFor(id: string): CostRate {
  const lower = id.toLowerCase();
  for (const key of Object.keys(COST_TABLE)) {
    if (lower.includes(key)) return COST_TABLE[key]!;
  }
  return { inputPer1k: 0.001, outputPer1k: 0.003 }; // sensible default
}

export function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const r = rateFor(modelId);
  return (inputTokens / 1000) * r.inputPer1k + (outputTokens / 1000) * r.outputPer1k;
}

export interface RoutedModel {
  providerId: string;
  modelId: string;
  cls: ModelClass;
  costPer1k: number;
}

/**
 * Cost-optimised router. Given a set of candidate (provider, model) pairs
 * and a desired class, returns the cheapest capable model.
 */
export class ModelRouter {
  constructor(private readonly registry: ProviderRegistry) {}

  candidates(): RoutedModel[] {
    const out: RoutedModel[] = [];
    for (const provider of this.registry.list()) {
      const fallback = provider.fallbackModels?.() ?? [];
      const models = fallback.length ? fallback : [{ id: provider.defaultModel, provider: provider.id, contextWindow: 0, supportsTools: false }];
      for (const m of models) {
        const r = rateFor(m.id);
        out.push({ providerId: provider.id, modelId: m.id, cls: classifyModel(m.id), costPer1k: r.inputPer1k + r.outputPer1k });
      }
    }
    return out;
  }

  route(desiredClass: ModelClass): RoutedModel | undefined {
    const viable = this.candidates().filter((c) => c.cls === desiredClass || (desiredClass === "chat" && c.cls !== "embedding"));
    viable.sort((a, b) => a.costPer1k - b.costPer1k);
    return viable[0];
  }

  /** Probe a model with a tiny prompt; returns latency + ok flag. */
  async benchmark(providerId: string, modelId: string): Promise<{ providerId: string; modelId: string; cls: ModelClass; ok: boolean; latencyMs: number; costPer1k: number }> {
    const t0 = Date.now();
    let ok = true;
    try {
      await this.registry.chat(providerId, {
        model: modelId,
        messages: [{ role: "user", content: "ping" }],
        stream: false,
        maxTokens: 8,
      });
    } catch {
      ok = false;
    }
    const r = rateFor(modelId);
    return { providerId, modelId, cls: classifyModel(modelId), ok, latencyMs: Date.now() - t0, costPer1k: r.inputPer1k + r.outputPer1k };
  }

  /** Benchmark every model for a provider (or every provider with --all). */
  async benchmarkAll(opts: { provider?: string; models?: Model[] }): Promise<Awaited<ReturnType<ModelRouter["benchmark"]>>[]> {
    const results: Awaited<ReturnType<ModelRouter["benchmark"]>>[] = [];
    const providers = opts.provider ? [this.registry.get(opts.provider)] : this.registry.list();
    for (const provider of providers) {
      const models = opts.models?.filter((m) => m.provider === provider.id) ?? provider.fallbackModels?.() ?? [{ id: provider.defaultModel, provider: provider.id, contextWindow: 0, supportsTools: false }];
      for (const m of models) {
        results.push(await this.benchmark(provider.id, m.id));
      }
    }
    return results;
  }
}
