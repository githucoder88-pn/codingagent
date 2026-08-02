/**
 * CODER — workflow library (Phase 4).
 *
 * A workflow is a named, ordered sequence of role steps that can be
 * "installed" (added to the user library) and run. Built-in workflows
 * (full-cycle, bugfix, ship) are seeded on first use; persisted at
 * ~/.coder/workflows/workflows.json. Running a workflow executes its role
 * sequence through the orchestration pipeline.
 */

import { join } from "node:path";
import { coderHome } from "../utils/paths.js";
import { JsonStore, nowIso, shortId } from "../runtime/store.js";
import { getAgentRole } from "./roles.js";

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: string[]; // role ids
  builtin: boolean;
  createdAt: string;
}

export interface WorkflowRegistryData {
  workflows: Record<string, Workflow>;
}

const FILE = () => join(coderHome(), "workflows", "workflows.json");

const BUILTIN_WORKFLOWS: Omit<Workflow, "id" | "builtin" | "createdAt">[] = [
  { name: "full-cycle", description: "analyze → plan → implement → test → review → report", steps: ["planner", "researcher", "developer", "tester", "reviewer", "documenter"] },
  { name: "bugfix", description: "reproduce → diagnose → fix → test → review", steps: ["researcher", "developer", "tester", "reviewer"] },
  { name: "ship", description: "review → security → document → deploy", steps: ["reviewer", "security", "documenter", "deployment"] },
];

export class WorkflowManager {
  private readonly store = new JsonStore<WorkflowRegistryData>(FILE(), { workflows: {} });
  private seeded = false;

  private ensureSeeded(): void {
    if (this.seeded) return;
    this.store.update((data) => {
      for (const wf of BUILTIN_WORKFLOWS) {
        if (!Object.values(data.workflows).some((w) => w.name === wf.name)) {
          const id = shortId("wf-");
          data.workflows[id] = { ...wf, id, builtin: true, createdAt: nowIso() };
        }
      }
    });
    this.seeded = true;
  }

  list(): Workflow[] {
    this.ensureSeeded();
    return Object.values(this.store.read().workflows).sort((a, b) => a.name.localeCompare(b.name));
  }

  findByName(name: string): Workflow | undefined {
    return this.list().find((w) => w.name.toLowerCase() === name.toLowerCase());
  }

  install(workflow: Omit<Workflow, "id" | "builtin" | "createdAt">): Workflow {
    const id = shortId("wf-");
    const full: Workflow = { ...workflow, id, builtin: false, createdAt: nowIso() };
    this.store.update((data) => (data.workflows[id] = full));
    return full;
  }

  /** Validate that every step resolves to a known agent role. */
  validate(workflow: Workflow): { ok: boolean; missing: string[] } {
    const missing = workflow.steps.filter((s) => !getAgentRole(s));
    return { ok: missing.length === 0, missing };
  }
}
