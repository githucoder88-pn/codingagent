/**
 * CODER — patch tools + diff engine.
 *
 * create_patch (unified diff via jsdiff), apply_patch (with fuzz),
 * validate_patch (apply to original + compare), and the diff helpers used
 * by `coder diff`, undo/redo, and checkpoints.
 */

import { createPatch, applyPatch as jsdiffApply, parsePatch } from "diff";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ToolDefinition, type ToolContext } from "./types.js";
import { type ToolResult } from "../workspace/types.js";

export interface FileChange {
  path: string;
  original: string;
  updated: string;
}

/** Compute a unified diff between two versions of a file. */
export function computeDiff(path: string, original: string, updated: string): string {
  return createPatch(path, original, updated, "CODER", undefined, { context: 3 });
}

/** Apply a unified diff to content, with fuzz. Returns null on failure. */
export function applyUnifiedPatch(content: string, patchText: string): string | null {
  try {
    const patches = parsePatch(patchText);
    if (patches.length === 0) return null;
    let result = content;
    let changed = false;
    for (const patch of patches) {
      if (patch.hunks.length === 0) continue;
      const applied = jsdiffApply(result, patch, { fuzzFactor: 2 });
      if (applied === false) return null;
      if (applied !== result) changed = true;
      result = applied;
    }
    // A patch with nothing applicable is not a valid application.
    return changed ? result : null;
  } catch {
    return null;
  }
}

function resolveFile(cwd: string, path: string): string {
  const resolved = join(cwd, path);
  if (!resolved.startsWith(cwd)) throw new Error(`Path escapes workspace: ${path}`);
  return resolved;
}

export const patchTools: ToolDefinition[] = [
  {
    id: "create_patch",
    name: "Create a diff",
    description: "Compute a unified diff between the working tree (or two files).",
    level: "safe",
    mutating: false,
    params: [
      { name: "path", type: "string", description: "File to diff against HEAD (git repo) or its original" },
      { name: "from", type: "string", description: "Original file content path" },
      { name: "to", type: "string", description: "Updated file content path" },
    ],
    async execute(params, ctx: ToolContext) {
      try {
        if (params.from && params.to) {
          const a = readFileSync(resolveFile(ctx.cwd, String(params.from)), "utf8");
          const b = readFileSync(resolveFile(ctx.cwd, String(params.to)), "utf8");
          return { ok: true, output: computeDiff(String(params.to), a, b) };
        }
        if (params.path) {
          const file = String(params.path);
          const full = resolveFile(ctx.cwd, file);
          const updated = readFileSync(full, "utf8");
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const exec = promisify(execFile);
          try {
            const { stdout } = await exec("git", ["show", `HEAD:${file}`], { cwd: ctx.cwd });
            return { ok: true, output: computeDiff(file, stdout, updated) };
          } catch {
            return { ok: true, output: `(new file) ${file}` };
          }
        }
        return { ok: false, output: "", error: "provide path or from/to" };
      } catch (err) {
        return { ok: false, output: "", error: (err as Error).message };
      }
    },
  },
  {
    id: "apply_patch",
    name: "Apply a patch",
    description: "Apply a unified diff to the working tree.",
    level: "balanced",
    mutating: true,
    params: [
      { name: "patch", type: "string", required: true, description: "Unified diff text" },
      { name: "path", type: "string", description: "Restrict to one file" },
    ],
    async execute(params, ctx: ToolContext) {
      const patchText = String(params.patch ?? "");
      if (!patchText.trim()) return { ok: false, output: "", error: "empty patch" };
      const patches = parsePatch(patchText);
      if (patches.length === 0) return { ok: false, output: "", error: "invalid patch" };
      let applied = 0;
      for (const patch of patches) {
        const file = patch.oldFileName?.replace(/^a\//, "") ?? patch.newFileName?.replace(/^b\//, "");
        if (!file) continue;
        if (params.path && file !== params.path) continue;
        const full = resolveFile(ctx.cwd, file);
        const before = readFileSync(full, "utf8");
        const after = applyUnifiedPatch(before, patchText);
        if (after === null) return { ok: false, output: "", error: `patch does not apply to ${file}` };
        if (ctx.onSnapshot) ctx.onSnapshot([file]).catch(() => {});
        writeFileSync(full, after, "utf8");
        ctx.touched.push(file);
        applied += 1;
      }
      return { ok: true, output: `Applied ${applied} patch(es)` };
    },
  },
  {
    id: "validate_patch",
    name: "Validate a patch",
    description: "Check whether a unified diff applies cleanly, without applying it.",
    level: "safe",
    mutating: false,
    params: [
      { name: "patch", type: "string", required: true, description: "Unified diff text" },
      { name: "path", type: "string", description: "Restrict to one file" },
    ],
    async execute(params, ctx: ToolContext) {
      const patchText = String(params.patch ?? "");
      const patches = parsePatch(patchText);
      if (patches.length === 0) return { ok: false, output: "", error: "invalid patch" };
      const results: string[] = [];
      for (const patch of patches) {
        const file = patch.oldFileName?.replace(/^a\//, "") ?? patch.newFileName?.replace(/^b\//, "");
        if (!file || (params.path && file !== params.path)) continue;
        const full = resolveFile(ctx.cwd, file);
        const before = readFileSync(full, "utf8");
        const after = applyUnifiedPatch(before, patchText);
        results.push(`${file}: ${after !== null ? "applies cleanly" : "FAILS to apply"}`);
      }
      return { ok: results.every((r) => !r.includes("FAILS")), output: results.join("\n") };
    },
  },
];

export function computeFileChange(path: string, original: string, updated: string): FileChange {
  return { path, original, updated };
}
