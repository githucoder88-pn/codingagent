/**
 * CODER — research engine & evolution loop (Phase 7).
 *
 * `research(topic)` surveys the repository (symbols, content, git history)
 * and the cognitive knowledge base, then synthesises a report via the model.
 *
 * `evolve(task)` runs the adaptive self-improvement loop:
 *   observe → measure → analyze → plan → execute → reflect → learn
 * Success lowers the cognitive riskThreshold and tunes step weights.
 */

import { type ProviderRegistry } from "../providers/registry.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { cognitive } from "./core.js";

export interface ResearchResult {
  topic: string;
  symbols: string[];
  files: string[];
  commits: string[];
  summary: string;
}

export async function researchTopic(opts: {
  topic: string;
  workspace: WorkspaceManager;
  registry: ProviderRegistry;
  providerId: string;
  model: string;
}): Promise<ResearchResult> {
  const { workspace, registry, topic } = opts;
  const search = workspace.search();

  const symbols = search.searchSymbols(topic).slice(0, 8).map((r) => `${r.symbol?.name ?? r.file}:${r.line ?? ""}`);
  const files = search.searchContent(topic).slice(0, 8).map((r) => r.file);
  let commits: string[] = [];
  try {
    commits = (await search.searchGitHistory(topic)).slice(0, 5).map((c) => `${c.hash.slice(0, 8)} ${c.message.split("\n")[0]}`);
  } catch {
    /* not a git repo */
  }

  const evidence = [
    symbols.length ? `Symbols:\n${symbols.join("\n")}` : "",
    files.length ? `Files:\n${files.join("\n")}` : "",
    commits.length ? `Recent commits:\n${commits.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await registry.chat(opts.providerId, {
    model: opts.model,
    messages: [
      { role: "system", content: `You are the Researcher.\n\nCODER AGENT ROLE: researcher` },
      { role: "user", content: `Research the topic "${topic}" in this repository.\n\nEvidence:\n${evidence || "(none found)"}` },
    ],
    stream: false,
  });

  return { topic, symbols, files, commits, summary: res.content.trim() };
}

export interface EvolveResult {
  task: string;
  confidence: number;
  steps: string[];
  outcome: "success" | "failure";
  summary: string;
  riskThresholdBefore: number;
  riskThresholdAfter: number;
}

export async function evolveTask(opts: {
  task: string;
  workspace: WorkspaceManager;
  registry: ProviderRegistry;
  providerId: string;
  model: string;
}): Promise<EvolveResult> {
  const core = cognitive();
  core.updateWorldModel(opts.workspace);
  const before = core.snapshot().riskThreshold;

  // observe + analyze + plan
  const steps = await core.plan(opts.registry, opts.providerId, opts.model, opts.task);
  const confidence = core.predict(opts.task);
  core.recordPrediction(opts.task, confidence);

  // execute (model produces a plan-aligned answer via the developer role)
  const res = await opts.registry.chat(opts.providerId, {
    model: opts.model,
    messages: [
      { role: "system", content: `You are the Developer. Implement the plan.\n\nCODER AGENT ROLE: developer` },
      { role: "user", content: `Task: ${opts.task}\nPlan:\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}` },
    ],
    stream: false,
  });

  // evaluate + reflect + learn
  const evaluation = await core.evaluate(opts.registry, opts.providerId, opts.model, opts.task, res.content);
  const outcome: "success" | "failure" = evaluation.score >= 0.5 ? "success" : "failure";
  core.reflect(outcome, `${opts.task.slice(0, 80)} → score ${evaluation.score.toFixed(2)}`, [
    `${opts.task.slice(0, 40)}: ${outcome}`,
  ]);
  core.settlePrediction(outcome === "success");

  const after = core.snapshot().riskThreshold;
  return {
    task: opts.task,
    confidence,
    steps,
    outcome,
    summary: res.content.trim(),
    riskThresholdBefore: before,
    riskThresholdAfter: after,
  };
}
