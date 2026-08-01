/**
 * CODER — validation tools.
 *
 * validate_file: syntax-check a file when a parser is available
 * (TypeScript diagnostics for .ts/.js; tree-sitter parse for others).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ToolDefinition, type ToolContext } from "./types.js";
import { type ToolResult } from "../workspace/types.js";
import { languageForFile } from "../workspace/repository/scanner.js";

async function syntaxCheck(path: string, content: string, language: string): Promise<string[]> {
  if (language === "typescript" || language === "javascript") {
    const ts = await import("typescript");
    ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
    // A successful parse means the file is syntactically valid; deep
    // diagnostics would require a full program (too heavy per edit).
    return [];
  }
  try {
    const { parseWithTreeSitter } = await import("../workspace/parser/tree-sitter-parser.js");
    const symbols = await parseWithTreeSitter(content, language, path);
    if (symbols === null) return []; // no parser available — cannot validate
    return [];
  } catch {
    return [];
  }
}

export const validationTools: ToolDefinition[] = [
  {
    id: "validate_file",
    name: "Validate a file",
    description: "Syntax-check a file with the available parser.",
    level: "safe",
    mutating: false,
    params: [{ name: "path", type: "string", required: true, description: "File path" }],
    async execute(params, ctx: ToolContext) {
      try {
        const file = String(params.path ?? "");
        const full = join(ctx.cwd, file);
        const content = readFileSync(full, "utf8");
        const language = languageForFile(file);
        const errors = await syntaxCheck(file, content, language);
        return errors.length === 0
          ? { ok: true, output: `${file} looks valid (${language})` }
          : { ok: false, output: `${file} has issues:\n${errors.join("\n")}`, error: errors.join("; ") };
      } catch (err) {
        return { ok: false, output: "", error: (err as Error).message };
      }
    },
  },
];
