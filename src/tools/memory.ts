/**
 * CODER — memory tools.
 *
 * A short-term notes store for the agent: `memory_note` (write a note
 * into the session memory) and `memory_recall` (retrieve notes). Notes are
 * per-session and kept in ~/.coder/cache/workspace/memory-<repo>.json.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ToolDefinition, type ToolContext } from "./types.js";
import { type ToolResult } from "../workspace/types.js";

interface MemoryFile {
  notes: Array<{ text: string; createdAt: string }>;
}

function memoryPath(cwd: string): string {
  const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
  const dir = join(process.env.CODER_HOME ?? `${process.env.HOME}/.coder`, "cache", "workspace");
  mkdirSync(dir, { recursive: true });
  return join(dir, `memory-${hash}.json`);
}

function load(cwd: string): MemoryFile {
  try {
    if (!existsSync(memoryPath(cwd))) return { notes: [] };
    return JSON.parse(readFileSync(memoryPath(cwd), "utf8")) as MemoryFile;
  } catch {
    return { notes: [] };
  }
}

function save(cwd: string, memory: MemoryFile): void {
  try {
    writeFileSync(memoryPath(cwd), JSON.stringify(memory), { mode: 0o600 });
  } catch {
    /* best effort */
  }
}

export const memoryTools: ToolDefinition[] = [
  {
    id: "memory_note",
    name: "Save a note",
    description: "Store a short note for later steps in this session.",
    level: "safe",
    mutating: false,
    params: [{ name: "text", type: "string", required: true, description: "Note text" }],
    async execute(params, ctx: ToolContext) {
      const text = String(params.text ?? "").slice(0, 2000);
      if (!text) return { ok: false, output: "", error: "empty note" };
      const memory = load(ctx.cwd);
      memory.notes.push({ text, createdAt: new Date().toISOString() });
      if (memory.notes.length > 200) memory.notes.splice(0, memory.notes.length - 200);
      save(ctx.cwd, memory);
      return { ok: true, output: `Note saved (${memory.notes.length} total).` };
    },
  },
  {
    id: "memory_recall",
    name: "Recall notes",
    description: "Retrieve notes from this session's memory (optionally matching text).",
    level: "safe",
    mutating: false,
    params: [{ name: "query", type: "string", description: "Filter notes by text" }],
    async execute(params, ctx: ToolContext) {
      const memory = load(ctx.cwd);
      const query = String(params.query ?? "").toLowerCase();
      const notes = query
        ? memory.notes.filter((n) => n.text.toLowerCase().includes(query))
        : memory.notes;
      if (notes.length === 0) return { ok: true, output: "(no notes)" };
      return { ok: true, output: notes.slice(-20).map((n) => `• ${n.text}`).join("\n") };
    },
  },
];
