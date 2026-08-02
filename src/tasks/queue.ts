/**
 * CODER — task queue (Phase 4).
 *
 * A persisted queue of background tasks at ~/.coder/tasks/queue.json. Each
 * task transitions queued → running → succeeded | failed | cancelled. The
 * orchestration/agent loops enqueue work; the daemon/pet drains it.
 */

import { join } from "node:path";
import { coderHome } from "../utils/paths.js";
import { JsonStore, nowIso, shortId } from "../runtime/store.js";

export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface Task {
  id: string;
  kind: string;
  description: string;
  status: TaskStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: string;
  error?: string;
  attempts: number;
}

export interface TaskQueueData {
  tasks: Task[];
}

const FILE = () => join(coderHome(), "tasks", "queue.json");

export class TaskQueue {
  private readonly store = new JsonStore<TaskQueueData>(FILE(), { tasks: [] });

  list(): Task[] {
    return this.store.read().tasks;
  }

  get(id: string): Task | undefined {
    return this.list().find((t) => t.id === id);
  }

  enqueue(kind: string, description: string): Task {
    const task: Task = {
      id: shortId("task-"),
      kind,
      description,
      status: "queued",
      createdAt: nowIso(),
      attempts: 0,
    };
    this.store.update((data) => data.tasks.unshift(task));
    return task;
  }

  setStatus(id: string, status: TaskStatus, extra?: { result?: string; error?: string }): Task | undefined {
    let updated: Task | undefined;
    this.store.update((data) => {
      const task = data.tasks.find((t) => t.id === id);
      if (!task) return;
      task.status = status;
      if (status === "running") {
        task.startedAt = nowIso();
        task.attempts += 1;
      }
      if (status === "succeeded" || status === "failed" || status === "cancelled") {
        task.finishedAt = nowIso();
      }
      if (extra?.result !== undefined) task.result = extra.result;
      if (extra?.error !== undefined) task.error = extra.error;
      updated = task;
    });
    return updated;
  }

  /** Move the next queued task to running (atomically). */
  claimNext(): Task | undefined {
    let claimed: Task | undefined;
    this.store.update((data) => {
      const task = data.tasks.find((t) => t.status === "queued");
      if (!task) return;
      task.status = "running";
      task.startedAt = nowIso();
      task.attempts += 1;
      claimed = task;
    });
    return claimed;
  }

  cancel(id: string): Task | undefined {
    return this.setStatus(id, "cancelled");
  }

  stats(): { queued: number; running: number; succeeded: number; failed: number; cancelled: number } {
    const tasks = this.list();
    const count = (s: TaskStatus) => tasks.filter((t) => t.status === s).length;
    return {
      queued: count("queued"),
      running: count("running"),
      succeeded: count("succeeded"),
      failed: count("failed"),
      cancelled: count("cancelled"),
    };
  }
}
