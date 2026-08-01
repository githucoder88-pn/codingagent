/**
 * CODER — execution scheduler.
 *
 * Executes tool calls under the permission engine, records every call
 * (ExecutionRecord), keeps "before" snapshots for mutating tools, and
 * maintains undo/redo stacks for the session.
 */

import { randomId } from "../../shared/src/index.js";
import { getTool } from "../tools/registry.js";
import { type ToolContext } from "../tools/types.js";
import { type ExecutionRecord, type PermissionLevel, type ToolResult } from "../workspace/types.js";
import { RollbackManager } from "./rollback.js";
import { checkPermission } from "./permissions.js";
import { ExecutionLedger, type LedgerRecord } from "./ledger.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface SchedulerOptions {
  cwd: string;
  level: PermissionLevel;
  interactive?: boolean;
  log?: (msg: string) => void;
  onRecord?: (record: ExecutionRecord) => void;
}

export class ExecutionScheduler {
  private readonly history: ExecutionRecord[] = [];
  private readonly redoStack: ExecutionRecord[] = [];
  private readonly rollback = new RollbackManager();

  constructor(private readonly opts: SchedulerOptions) {}

  get cwd(): string {
    return this.opts.cwd;
  }

  get level(): PermissionLevel {
    return this.opts.level;
  }

  historyEntries(): ExecutionRecord[] {
    return [...this.history];
  }

  /** Execute a tool call. Returns the tool result (permission failures are results). */
  async execute(toolId: string, params: Record<string, unknown>): Promise<ToolResult> {
    const tool = getTool(toolId);
    if (!tool) {
      return { ok: false, output: "", error: `Unknown tool "${toolId}". Run \`coder tools\` to list tools.` };
    }

    const decision = await checkPermission(tool, this.opts.level, {
      interactive: this.opts.interactive,
    });
    if (!decision.allowed) {
      return { ok: false, output: "", error: `Permission denied: ${tool.id} ${decision.reason ?? ""}` };
    }

    const touched: string[] = [];
    let snapshotId: string | undefined;
    const ctx: ToolContext = {
      cwd: this.opts.cwd,
      log: this.opts.log,
      touched,
      onSnapshot: async (files) => {
        if (snapshotId) return snapshotId;
        snapshotId = this.rollback.snapshot(this.opts.cwd, files);
        return snapshotId;
      },
    };

    let result: ToolResult;
    try {
      result = await tool.execute(params, ctx);
    } catch (err) {
      result = { ok: false, output: "", error: (err as Error).message };
    }

    const record: ExecutionRecord = {
      id: randomId("rec"),
      tool: toolId,
      params,
      requiredLevel: tool.level,
      result,
      touched: [...touched],
      snapshotId,
      timestamp: new Date().toISOString(),
      ok: result.ok,
    };
    this.history.push(record);
    this.redoStack.length = 0; // new actions invalidate redo
    this.opts.onRecord?.(record);

    // Persist to the cross-invocation ledger (undo/redo/diff support).
    try {
      const ledgerRecord: LedgerRecord = {
        id: record.id,
        tool: toolId,
        touched: [...touched],
        timestamp: record.timestamp,
        ok: result.ok,
      };
      if (snapshotId) {
        const entries = this.rollback.peek(snapshotId);
        const first = entries?.keys().next().value;
        if (first) {
          const before = entries!.get(first);
          ledgerRecord.snapshot = before ?? "";
          ledgerRecord.snapshotAbsent = before === null;
          try {
            ledgerRecord.after = readFileSync(join(this.opts.cwd, first), "utf8");
          } catch {
            ledgerRecord.after = "";
          }
        }
      }
      new ExecutionLedger(this.opts.cwd).push(ledgerRecord);
    } catch {
      /* ledger is best-effort */
    }
    return result;
  }

  /** Undo the last mutating call: restore its snapshot. */
  undo(): { record: ExecutionRecord; restored: string[] } | null {
    for (let i = this.history.length - 1; i >= 0; i -= 1) {
      const record = this.history[i]!;
      if (record.snapshotId && record.touched.length > 0) {
        const restored = this.rollback.restore(record.snapshotId, this.opts.cwd);
        this.history.splice(i, 1);
        this.redoStack.push(record);
        return { record, restored };
      }
    }
    return null;
  }

  /** Redo the last undone call (restores the "after" content via git or snapshots). */
  redo(): { record: ExecutionRecord } | null {
    const record = this.redoStack.pop();
    if (!record) return null;
    // Re-execute the tool call against the current state.
    void this.execute(record.tool, record.params).catch(() => {});
    return { record };
  }

  get undoCount(): number {
    return this.history.filter((r) => r.snapshotId).length;
  }

  get redoCount(): number {
    return this.redoStack.length;
  }
}
