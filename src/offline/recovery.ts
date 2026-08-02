/**
 * CODER — task recovery (Phase 11).
 *
 * Re-queues failed local tasks once. A persisted `retried` marker prevents
 * retry loops. Runs continuously inside the pet/daemon; also exposed as
 * `coder recover` for manual use.
 */

import { TaskQueue, type Task } from "../tasks/queue.js";
import { JsonStore } from "../runtime/store.js";
import { join } from "node:path";
import { coderHome } from "../utils/paths.js";

interface RecoveryState {
  retried: string[];
}

const FILE = () => join(coderHome(), "cache", "recovery.json");

export class RecoveryEngine {
  private readonly state = new JsonStore<RecoveryState>(FILE(), { retried: [] });

  /** Find failed tasks that have not yet been retried, re-queue them once. */
  recover(): { recovered: Task[]; skipped: number } {
    const queue = new TaskQueue();
    const failed = queue.list().filter((t) => t.status === "failed");
    const already = new Set(this.state.read().retried);
    const recovered: Task[] = [];
    let skipped = 0;

    for (const task of failed) {
      if (already.has(task.id)) {
        skipped += 1;
        continue;
      }
      const requeued = queue.enqueue(task.kind, task.description);
      queue.setStatus(requeued.id, "queued");
      this.state.update((s) => {
        if (!s.retried.includes(task.id)) s.retried.push(task.id);
      });
      recovered.push(requeued);
    }
    return { recovered, skipped };
  }

  /** Clear the retry marker history (e.g. after a successful flush). */
  reset(): void {
    this.state.write({ retried: [] });
  }
}
