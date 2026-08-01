/**
 * CODER — rollback manager.
 *
 * Keeps "before" snapshots of every file touched by mutating tool calls.
 * Snapshots are stored in memory for the session (undo/redo) and, for
 * checkpoints, on disk under ~/.coder/checkpoints.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";

export interface Snapshot {
  id: string;
  files: Map<string, string | null>; // relPath -> original content (null = file did not exist)
  timestamp: string;
}

let nextId = 1;

export class RollbackManager {
  private snapshots = new Map<string, Snapshot>();

  /** Snapshot the current content of files (rel paths) under `root`. */
  snapshot(root: string, files: string[]): string {
    const entries = new Map<string, string | null>();
    for (const file of files) {
      try {
        const full = join(root, file);
        entries.set(file, existsSync(full) ? readFileSync(full, "utf8") : null);
      } catch {
        entries.set(file, null);
      }
    }
    const id = `snap-${Date.now()}-${nextId++}`;
    this.snapshots.set(id, { id, files: entries, timestamp: new Date().toISOString() });
    return id;
  }

  /** Restore the pre-call content of every file in the snapshot. */
  restore(id: string, root: string): string[] {
    const snapshot = this.snapshots.get(id);
    if (!snapshot) return [];
    const restored: string[] = [];
    for (const [file, content] of snapshot.files) {
      const full = join(root, file);
      try {
        if (content === null) {
          // The file did not exist before the call — remove it.
          rmSync(full, { force: true });
        } else {
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, content, "utf8");
        }
        restored.push(file);
      } catch {
        /* best effort */
      }
    }
    return restored;
  }

  /** Peek at a snapshot's file entries (without restoring). */
  peek(id: string): Map<string, string | null> | undefined {
    return this.snapshots.get(id)?.files;
  }

  drop(id: string): void {
    this.snapshots.delete(id);
  }

  has(id: string): boolean {
    return this.snapshots.has(id);
  }

  // ------------------------------------------------------- on-disk checkpoints

  static checkpointDir(repoRoot: string): string {
    const hash = createHash("sha256").update(resolve(repoRoot)).digest("hex").slice(0, 12);
    const base = join(process.env.CODER_HOME ?? `${process.env.HOME}/.coder`, "checkpoints", hash);
    mkdirSync(base, { recursive: true });
    return base;
  }

  /** Copy the given files (or a whole directory) into a checkpoint. */
  static createCheckpoint(repoRoot: string, name: string, files: string[]): { id: string; dir: string } {
    const id = `${name}-${Date.now().toString(36)}`;
    const dir = join(this.checkpointDir(repoRoot), id);
    mkdirSync(dir, { recursive: true });
    let count = 0;
    for (const file of files) {
      try {
        const full = join(repoRoot, file);
        if (!existsSync(full)) continue;
        const target = join(dir, file);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(full, target);
        count += 1;
      } catch {
        /* skip unreadable */
      }
    }
    return { id, dir: relative(this.checkpointDir(repoRoot), dir) || id };
  }

  static listCheckpoints(repoRoot: string): Array<{ id: string; dir: string; files: number; createdAt: string }> {
    const base = this.checkpointDir(repoRoot);
    try {
      return readdirSync(base, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => {
          const dir = join(base, e.name);
          let files = 0;
          const count = (d: string): void => {
            for (const entry of readdirSync(d, { withFileTypes: true })) {
              if (entry.isDirectory()) count(join(d, entry.name));
              else files += 1;
            }
          };
          try {
            count(dir);
          } catch {
            /* ignore */
          }
          return { id: e.name, dir: e.name, files, createdAt: e.name.split("-").slice(1).join("-") };
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  }

  static restoreCheckpoint(repoRoot: string, id: string): string[] {
    const base = this.checkpointDir(repoRoot);
    const dir = join(base, id);
    if (!existsSync(dir)) throw new Error(`Checkpoint "${id}" not found.`);
    const restored: string[] = [];
    const walk = (d: string): void => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        const rel = relative(base, full).split(/[\\/]/).slice(1).join("/");
        const target = join(repoRoot, rel);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(full, target);
        restored.push(rel);
      }
    };
    walk(dir);
    return restored;
  }

  static deleteCheckpoint(repoRoot: string, id: string): boolean {
    const dir = join(this.checkpointDir(repoRoot), id);
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
  }
}
