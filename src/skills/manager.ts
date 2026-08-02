/**
 * CODER — skill library (Phase 4).
 *
 * Skills are reusable, named instruction bundles (system-prompt fragments
 * + recommended tools) that prime an agent for a domain (react, python,
 * devops, database, security, ui, …). Built-in skills ship with the CLI;
 * users can install more or create their own. Persisted at
 * ~/.coder/skills/skills.json.
 */

import { join } from "node:path";
import { coderHome } from "../utils/paths.js";
import { JsonStore, nowIso, shortId } from "../runtime/store.js";

export interface Skill {
  id: string;
  name: string;
  domain: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  builtin: boolean;
  createdAt: string;
}

export interface SkillRegistryData {
  skills: Record<string, Skill>;
}

const FILE = () => join(coderHome(), "skills", "skills.json");

/** Built-in skills seeded on first use. */
const BUILTIN_SKILLS: Omit<Skill, "id" | "builtin" | "createdAt">[] = [
  { name: "react", domain: "frontend", description: "React + TypeScript component design.", systemPrompt: "Follow React + TypeScript best practices: functional components, hooks, small props interfaces, accessible markup.", tools: ["read_file", "write_file", "search", "run_tests"] },
  { name: "python", domain: "backend", description: "Idiomatic Python services and scripts.", systemPrompt: "Write idiomatic, typed Python. Prefer stdlib, small functions, clear errors, and tests.", tools: ["read_file", "write_file", "search", "execute_script", "run_tests"] },
  { name: "devops", domain: "infra", description: "CI/CD, containers and deployment.", systemPrompt: "Automate delivery: reproducible builds, infrastructure as code, health checks and rollback.", tools: ["read_file", "write_file", "execute_command", "run_build"] },
  { name: "database", domain: "backend", description: "Schema design and query tuning.", systemPrompt: "Design normalized schemas with proper indexes and constraints; tune queries; guard against injection.", tools: ["read_file", "write_file", "search", "execute_command"] },
  { name: "security", domain: "security", description: "Threat modelling and hardening.", systemPrompt: "Threat-model changes. Validate input, scope authz, avoid secrets in code, pin dependencies.", tools: ["read_file", "search", "git_log", "validate"] },
  { name: "ui", domain: "frontend", description: "Accessible, polished interfaces.", systemPrompt: "Design accessible, responsive UIs with a clear hierarchy, consistent spacing and keyboard support.", tools: ["read_file", "write_file", "search"] },
  { name: "testing", domain: "quality", description: "Test strategy and coverage.", systemPrompt: "Build a testing pyramid: fast unit tests, focused integration tests, few resilient e2e tests.", tools: ["read_file", "write_file", "run_tests", "execute_command"] },
  { name: "refactor", domain: "quality", description: "Safe, behaviour-preserving refactors.", systemPrompt: "Refactor in small, behaviour-preserving steps. Lean on tests and the type system.", tools: ["read_file", "write_file", "search", "run_tests"] },
];

export class SkillManager {
  private readonly store = new JsonStore<SkillRegistryData>(FILE(), { skills: {} });
  private seeded = false;

  /** Seed built-in skills on first access (idempotent). */
  private ensureSeeded(): void {
    if (this.seeded) return;
    this.store.update((data) => {
      for (const skill of BUILTIN_SKILLS) {
        if (!Object.values(data.skills).some((s) => s.name === skill.name)) {
          const id = shortId("skill-");
          data.skills[id] = { ...skill, id, builtin: true, createdAt: nowIso() };
        }
      }
    });
    this.seeded = true;
  }

  list(): Skill[] {
    this.ensureSeeded();
    return Object.values(this.store.read().skills).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): Skill | undefined {
    this.ensureSeeded();
    return this.store.read().skills[id];
  }

  findByName(name: string): Skill | undefined {
    return this.list().find((s) => s.name.toLowerCase() === name.toLowerCase());
  }

  install(skill: Omit<Skill, "id" | "builtin" | "createdAt">): Skill {
    const id = shortId("skill-");
    const full: Skill = { ...skill, id, builtin: false, createdAt: nowIso() };
    this.store.update((data) => (data.skills[id] = full));
    return full;
  }

  create(input: { name: string; domain: string; description: string; systemPrompt: string; tools?: string[] }): Skill {
    return this.install({
      name: input.name,
      domain: input.domain,
      description: input.description,
      systemPrompt: input.systemPrompt,
      tools: input.tools ?? [],
    });
  }

  /** Render the skill as an agent priming block. */
  render(skill: Skill): string {
    return [
      `# Skill: ${skill.name} (${skill.domain})`,
      skill.description,
      "",
      skill.systemPrompt,
      skill.tools.length ? `Recommended tools: ${skill.tools.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
}
