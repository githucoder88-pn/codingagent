/**
 * CODER — execution ledger.
 *
 * Persists the session's execution records (with before/after file
 * content) to ~/.coder/cache/workspace/execution-<repo>.json so `coder
 * undo` / `coder redo` / `coder diff` work across CLI invocations within
 * a workspace.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface LedgerRecord {
  id: string;
  tool: string;
  touched: string[];
  /** Original content of the first touched file (for undo). */
  snapshot?: string;
  /** True when the file did not exist before the call (undo deletes it). */
  snapshotAbsent?: boolean;
  /** Content after the call (for diff/redo). */
  after?: string;
  timestamp: string;
  ok: boolean;
}

interface LedgerFile {
  records: LedgerRecord[];
  redo: LedgerRecord[];
}

function ledgerPath(root: string): string {
  const hash = createHash("sha256").update(resolve(root)).digest("hex").slice(0, 16);
  const dir = join(process.env.CODER_HOME ?? `${process.env.HOME}/.coder`, "cache", "workspace");
  mkdirSync(dir, { recursive: true });
  return join(dir, `execution-${hash}.json`);
}

export class ExecutionLedger {
  constructor(private readonly root: string) {}

  private load(): LedgerFile {
    try {
      if (!existsSync(ledgerPath(this.root))) return { records: [], redo: [] };
      return JSON.parse(readFileSync(ledgerPath(this.root), "utf8")) as LedgerFile;
    } catch {
      return { records: [], redo: [] };
    }
  }

  private save(data: LedgerFile): void {
    try {
      writeFileSync(ledgerPath(this.root), JSON.stringify(data), { mode: 0o600 });
    } catch {
      /* best effort */
    }
  }

  /** Append a record (called by the scheduler hook). */
  push(record: LedgerRecord): void {
    const data = this.load();
    data.records.push(record);
    if (data.records.length > 500) data.records.splice(0, data.records.length - 500);
    data.redo = [];
    this.save(data);
  }

  recentMutating(limit: number): LedgerRecord[] {
    return this.load().records.filter((r) => r.touched.length > 0 && r.snapshot !== undefined).slice(-limit).reverse();
  }

  undo(): { record: LedgerRecord; restored: string[] } | null {
    const data = this.load();
    for (let i = data.records.length - 1; i >= 0; i -= 1) {
      const record = data.records[i]!;
      if (record.touched.length > 0 && record.snapshot !== undefined) {
        const restored: string[] = [];
        for (const file of record.touched) {
          const full = join(this.root, file);
          if (record.snapshotAbsent) {
            rmSync(full, { force: true });
          } else {
            mkdirSync(dirname(full), { recursive: true });
            writeFileSync(full, record.snapshot, "utf8");
          }
          restored.push(file);
        }
        data.records.splice(i, 1);
        data.redo.push(record);
        this.save(data);
        return { record, restored };
      }
    }
    return null;
  }

  redo(): { record: LedgerRecord } | null {
    const data = this.load();
    const record = data.redo.pop();
    if (!record) return null;
    if (record.after !== undefined && record.touched[0]) {
      const full = join(this.root, record.touched[0]!);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, record.after, "utf8");
    }
    data.records.push(record);
    this.save(data);
    return { record };
  }
}
