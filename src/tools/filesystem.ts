/**
 * CODER — filesystem tools.
 *
 * read_file, write_file, append_file, replace_text, delete_file,
 * rename_file, copy_file, move_file, create_directory, list_directory.
 * All paths are resolved against the workspace root and confined to it.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve, relative, dirname, basename } from "node:path";
import { type ToolDefinition, type ToolContext } from "./types.js";
import { type ToolResult } from "../workspace/types.js";
import { hashFileContent } from "../workspace/repository/scanner.js";

function resolvePath(cwd: string, raw: string): string {
  const resolved = resolve(cwd, raw);
  const rel = relative(resolve(cwd), resolved);
  if (rel.startsWith("..") || resolve(rel) === resolve("..")) {
    throw new Error(`Path escapes the workspace root: ${raw}`);
  }
  return resolved;
}

function ok(output: string, data?: unknown): ToolResult {
  return { ok: true, output, data };
}

function fail(error: string): ToolResult {
  return { ok: false, output: "", error };
}

const pathParam = (name = "path"): { name: string; type: "string"; required: boolean; description: string } => ({
  name,
  type: "string",
  required: true,
  description: "Path relative to the workspace root",
});

const fileHashCache = new Map<string, string>();

export function hashOf(cwd: string, path: string): string {
  const full = resolvePath(cwd, path);
  const key = `${full}:${statSync(full).mtimeMs}`;
  if (fileHashCache.has(key)) return fileHashCache.get(key)!;
  const content = readFileSync(full, "utf8");
  const hash = hashFileContent(content);
  fileHashCache.set(key, hash);
  if (fileHashCache.size > 10_000) fileHashCache.clear();
  return hash;
}

export const filesystemTools: ToolDefinition[] = [
  {
    id: "read_file",
    name: "Read a file",
    description: "Read a file's content (optionally a line range) from the workspace.",
    level: "safe",
    mutating: false,
    params: [
      pathParam(),
      { name: "startLine", type: "number", description: "1-based start line" },
      { name: "endLine", type: "number", description: "1-based end line (inclusive)" },
    ],
    async execute(params, ctx: ToolContext) {
      try {
        const full = resolvePath(ctx.cwd, String(params.path));
        if (!existsSync(full) || !statSync(full).isFile()) return fail(`File not found: ${params.path}`);
        const content = readFileSync(full, "utf8");
        const lines = content.split(/\r?\n/);
        const start = Number(params.startLine ?? 1);
        const end = Number(params.endLine ?? lines.length);
        const slice = lines.slice(Math.max(1, start) - 1, Math.max(1, end)).join("\n");
        return ok(`${params.path} (${lines.length} lines)\n${slice}`);
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  },
  {
    id: "write_file",
    name: "Write a file",
    description: "Create or overwrite a file with the given content.",
    level: "balanced",
    mutating: true,
    params: [
      pathParam(),
      { name: "content", type: "string", required: true, description: "Full new content" },
    ],
    async execute(params, ctx: ToolContext) {
      try {
        const full = resolvePath(ctx.cwd, String(params.path));
        mkdirSync(dirname(full), { recursive: true });
        // Snapshot BEFORE the mutation so undo restores the true "before".
        if (ctx.onSnapshot) ctx.onSnapshot([String(params.path)]).catch(() => {});
        writeFileSync(full, String(params.content ?? ""), "utf8");
        ctx.touched.push(String(params.path));
        return ok(`Wrote ${params.path} (${Buffer.byteLength(String(params.content ?? ""), "utf8")} bytes)`);
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  },
  {
    id: "append_file",
    name: "Append to a file",
    description: "Append content to the end of a file (creating it if needed).",
    level: "balanced",
    mutating: true,
    params: [
      pathParam(),
      { name: "content", type: "string", required: true, description: "Content to append" },
    ],
    async execute(params, ctx: ToolContext) {
      try {
        const full = resolvePath(ctx.cwd, String(params.path));
        mkdirSync(dirname(full), { recursive: true });
        const before = existsSync(full) ? readFileSync(full, "utf8") : "";
        if (ctx.onSnapshot) ctx.onSnapshot([String(params.path)]).catch(() => {});
        writeFileSync(full, `${before}${before && !before.endsWith("\n") ? "\n" : ""}${params.content}`, "utf8");
        ctx.touched.push(String(params.path));
        return ok(`Appended to ${params.path}`);
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  },
  {
    id: "replace_text",
    name: "Replace text in a file",
    description: "Replace occurrences of `find` with `replace` (string or regex with `useRegex`).",
    level: "balanced",
    mutating: true,
    params: [
      pathParam(),
      { name: "find", type: "string", required: true, description: "Text (or regex) to find" },
      { name: "replace", type: "string", required: true, description: "Replacement text" },
      { name: "useRegex", type: "boolean", description: "Treat `find` as a regex" },
      { name: "count", type: "number", description: "Max replacements (default: all)" },
    ],
    async execute(params, ctx: ToolContext) {
      try {
        const full = resolvePath(ctx.cwd, String(params.path));
        if (!existsSync(full)) return fail(`File not found: ${params.path}`);
        const before = readFileSync(full, "utf8");
        const count = Number(params.count ?? Infinity);
        let after: string;
        let replaced = 0;
        if (params.useRegex) {
          const regex = new RegExp(String(params.find), "g");
          after = before.replace(regex, (match) => {
            if (replaced >= count) return match;
            replaced += 1;
            return String(params.replace ?? "");
          });
        } else {
          after = before.split(String(params.find)).join(String(params.replace ?? ""));
          replaced = before.split(String(params.find)).length - 1;
        }
        if (replaced === 0) return fail(`Pattern not found in ${params.path}: ${params.find}`);
        if (ctx.onSnapshot) ctx.onSnapshot([String(params.path)]).catch(() => {});
        writeFileSync(full, after, "utf8");
        ctx.touched.push(String(params.path));
        return ok(`Replaced ${replaced} occurrence(s) in ${params.path}`);
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  },
  {
    id: "delete_file",
    name: "Delete a file",
    description: "Delete a file (never directories).",
    level: "balanced",
    mutating: true,
    params: [pathParam()],
    async execute(params, ctx: ToolContext) {
      try {
        const full = resolvePath(ctx.cwd, String(params.path));
        if (!existsSync(full)) return fail(`File not found: ${params.path}`);
        if (statSync(full).isDirectory()) return fail("delete_file only removes files; use the shell for directories.");
        if (ctx.onSnapshot) ctx.onSnapshot([String(params.path)]).catch(() => {});
        rmSync(full, { force: true });
        ctx.touched.push(String(params.path));
        return ok(`Deleted ${params.path}`);
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  },
  {
    id: "rename_file",
    name: "Rename / move a file",
    description: "Rename or move a file (or directory) within the workspace.",
    level: "balanced",
    mutating: true,
    params: [
      pathParam("from"),
      { name: "to", type: "string", required: true, description: "Destination path" },
    ],
    async execute(params, ctx: ToolContext) {
      try {
        const from = resolvePath(ctx.cwd, String(params.from));
        const to = resolvePath(ctx.cwd, String(params.to));
        if (!existsSync(from)) return fail(`Not found: ${params.from}`);
        mkdirSync(dirname(to), { recursive: true });
        if (ctx.onSnapshot) ctx.onSnapshot([String(params.from)]).catch(() => {});
        renameSync(from, to);
        ctx.touched.push(String(params.from), String(params.to));
        return ok(`Renamed ${params.from} → ${params.to}`);
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  },
  {
    id: "copy_file",
    name: "Copy a file",
    description: "Copy a file to a new path in the workspace.",
    level: "balanced",
    mutating: true,
    params: [
      pathParam("from"),
      { name: "to", type: "string", required: true, description: "Destination path" },
    ],
    async execute(params, ctx: ToolContext) {
      try {
        const from = resolvePath(ctx.cwd, String(params.from));
        const to = resolvePath(ctx.cwd, String(params.to));
        if (!existsSync(from)) return fail(`Not found: ${params.from}`);
        mkdirSync(dirname(to), { recursive: true });
        if (ctx.onSnapshot) ctx.onSnapshot([String(params.to)]).catch(() => {});
        copyFileSync(from, to);
        ctx.touched.push(String(params.to));
        return ok(`Copied ${params.from} → ${params.to}`);
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  },
  {
    id: "create_directory",
    name: "Create a directory",
    description: "Create a directory (and parents) in the workspace.",
    level: "balanced",
    mutating: true,
    params: [pathParam("dir")],
    async execute(params, ctx: ToolContext) {
      try {
        const full = resolvePath(ctx.cwd, String(params.dir));
        mkdirSync(full, { recursive: true });
        return ok(`Created directory ${params.dir}`);
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  },
  {
    id: "list_directory",
    name: "List a directory",
    description: "List entries of a directory (files and dirs, shallow).",
    level: "safe",
    mutating: false,
    params: [
      { name: "dir", type: "string", description: "Directory (default: workspace root)" },
      { name: "recursive", type: "boolean", description: "List recursively (bounded)" },
    ],
    async execute(params, ctx: ToolContext) {
      try {
        const full = resolvePath(ctx.cwd, String(params.dir ?? "."));
        if (!existsSync(full)) return fail(`Directory not found: ${params.dir ?? "."}`);
        if (!statSync(full).isDirectory()) return fail(`Not a directory: ${params.dir ?? "."}`);
        const entries = params.recursive
          ? listRecursive(full, 3)
          : readdirSync(full, { withFileTypes: true }).map((e) => `${e.isDirectory() ? "📁" : "  "} ${e.name}`);
        return ok(entries.join("\n"));
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  },
];

/** `move_file` — alias of rename_file (spec lists both operations). */
export const moveFileTool: ToolDefinition = {
  id: "move_file",
  name: "Move a file",
  description: "Move a file (or directory) to a new path within the workspace (alias of rename_file).",
  level: "balanced",
  mutating: true,
  params: [
    pathParam("from"),
    { name: "to", type: "string", required: true, description: "Destination path" },
  ],
  async execute(params, ctx: ToolContext) {
    const rename = filesystemTools.find((t) => t.id === "rename_file")!;
    return rename.execute(params, ctx);
  },
};

function listRecursive(dir: string, depth: number): string[] {
  if (depth <= 0) return [];
  const out: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const rel = relative(dir, join(dir, entry.name));
      out.push(`${entry.isDirectory() ? "📁" : "  "} ${rel}`);
      if (entry.isDirectory()) out.push(...listRecursive(join(dir, entry.name), depth - 1));
    }
  } catch {
    /* skip */
  }
  return out;
}

export function findTool(id: string): ToolDefinition | undefined {
  return filesystemTools.find((t) => t.id === id);
}

export { basename };
