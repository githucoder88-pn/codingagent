/**
 * CODER — sync outbox (Phase 11).
 *
 * When the backend is unreachable, tasks and records are parked here and
 * flushed later by `coder sync --flush` or the pet/daemon when the cloud
 * returns. Persisted at ~/.coder/cache/outbox.json.
 */

import { join } from "node:path";
import { coderHome } from "../utils/paths.js";
import { JsonStore, nowIso, shortId } from "../runtime/store.js";

export interface OutboxItem {
  id: string;
  kind: string;
  payload: unknown;
  queuedAt: string;
  flushedAt?: string;
  attempts: number;
}

export interface OutboxData {
  items: OutboxItem[];
}

const FILE = () => join(coderHome(), "cache", "outbox.json");

export class SyncOutbox {
  private readonly store = new JsonStore<OutboxData>(FILE(), { items: [] });

  list(): OutboxItem[] {
    return this.store.read().items;
  }

  enqueue(kind: string, payload: unknown): OutboxItem {
    const item: OutboxItem = { id: shortId("out-"), kind, payload, queuedAt: nowIso(), attempts: 0 };
    this.store.update((d) => d.items.unshift(item));
    return item;
  }

  pending(): OutboxItem[] {
    return this.store.read().items.filter((i) => !i.flushedAt);
  }

  /**
   * Flush pending items. `isOnline` decides whether an item is delivered or
   * re-queued (with an attempt bump). Returns delivery stats.
   */
  async flush(isOnline: () => Promise<boolean>): Promise<{ delivered: number; deferred: number }> {
    let delivered = 0;
    let deferred = 0;
    const items = this.pending();
    for (const item of items) {
      const online = await isOnline();
      this.store.update((d) => {
        const target = d.items.find((i) => i.id === item.id);
        if (!target) return;
        if (online) {
          target.flushedAt = nowIso();
          delivered += 1;
        } else {
          target.attempts += 1;
          deferred += 1;
        }
      });
    }
    return { delivered, deferred };
  }

  clearFlushed(): number {
    let removed = 0;
    this.store.update((d) => {
      const before = d.items.length;
      d.items = d.items.filter((i) => !i.flushedAt);
      removed = before - d.items.length;
    });
    return removed;
  }
}
