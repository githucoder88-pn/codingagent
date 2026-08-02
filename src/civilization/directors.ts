/**
 * CODER — autonomous engineering civilization (Phase 9).
 *
 * A civilization is an Executive Director plus department Directors
 * (Architecture, Research, Engineering, Security, Infrastructure,
 * Documentation, Quality). Each director maps onto a real agent role and a
 * keyword layer: a goal containing "security" summons the Security Director,
 * "deploy"/"infra" summons Infrastructure, and so on.
 *
 * `civilization run(goal)` runs: strategic planning → agent allocation →
 * execution → evaluation → reflection → knowledge update.
 */

import { getAgentRole, listAgentRoles, type AgentRole } from "../orchestration/roles.js";

export interface Director {
  id: string;
  title: string;
  /** Underlying agent role id. */
  roleId: string;
  layer: string;
  keywords: string[];
  responsibility: string;
}

export const DIRECTORS: Director[] = [
  { id: "executive", title: "Executive Director", roleId: "coordinator", layer: "executive", keywords: ["strategy", "roadmap", "goal", "plan"], responsibility: "Set strategy and allocate directors." },
  { id: "architect", title: "Chief Architect", roleId: "architect", layer: "architecture", keywords: ["design", "architecture", "system", "structure"], responsibility: "Own system design and boundaries." },
  { id: "research", title: "Director of Research", roleId: "researcher", layer: "research", keywords: ["investigate", "research", "explore", "survey"], responsibility: "Investigate options and gather evidence." },
  { id: "engineering", title: "Director of Engineering", roleId: "developer", layer: "engineering", keywords: ["build", "implement", "feature", "code", "fix"], responsibility: "Build and integrate the solution." },
  { id: "security", title: "Director of Security", roleId: "security", layer: "security", keywords: ["security", "vulnerab", "auth", "secret", "cve"], responsibility: "Threat-model and harden the change." },
  { id: "infra", title: "Director of Infrastructure", roleId: "deployment", layer: "infrastructure", keywords: ["deploy", "infra", "kubernetes", "container", "ci", "scale"], responsibility: "Package, deploy and operate." },
  { id: "docs", title: "Director of Documentation", roleId: "documenter", layer: "documentation", keywords: ["document", "docs", "readme", "guide"], responsibility: "Keep knowledge accurate and discoverable." },
  { id: "quality", title: "Director of Quality", roleId: "tester", layer: "quality", keywords: ["test", "quality", "coverage", "bug", "flaky"], responsibility: "Protect correctness with tests." },
];

export const DIRECTOR_ALIASES: Record<string, string> = {
  architect: "architect",
  research: "research",
  security: "security",
  infra: "infra",
  infrastructure: "infra",
  docs: "docs",
  documentation: "docs",
  quality: "quality",
  engineering: "engineering",
  executive: "executive",
  exec: "executive",
};

export function getDirector(idOrAlias: string): Director | undefined {
  const id = DIRECTOR_ALIASES[idOrAlias.toLowerCase()] ?? idOrAlias.toLowerCase();
  return DIRECTORS.find((d) => d.id === id);
}

export function listDirectors(): Director[] {
  return DIRECTORS;
}

/** Select the directors whose keyword layers match a goal (always includes executive). */
export function allocateDirectors(goal: string): Director[] {
  const g = goal.toLowerCase();
  const matched = DIRECTORS.filter((d) => d.id !== "executive" && d.keywords.some((k) => g.includes(k)));
  const executive = DIRECTORS.find((d) => d.id === "executive")!;
  // Always include engineering + quality for any build goal.
  const ensure = ["engineering", "quality"];
  for (const id of ensure) {
    if (!matched.some((d) => d.id === id)) matched.push(DIRECTORS.find((d) => d.id === id)!);
  }
  return [executive, ...matched];
}

/** Resolve a director to its underlying agent role. */
export function directorRole(director: Director): AgentRole | undefined {
  return getAgentRole(director.roleId) ?? listAgentRoles().find((r) => r.id === director.roleId);
}
