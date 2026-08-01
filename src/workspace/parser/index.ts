/**
 * CODER — parser factory.
 *
 * Dispatches symbol parsing by language:
 *   1. TypeScript compiler API  — .ts/.tsx/.js/.jsx (rich, precise)
 *   2. Tree-sitter (WASM)       — python, go, rust, java, c, cpp, csharp, php
 *   3. Regex fallback           — anything else / when parsers unavailable
 */

import { type SymbolInfo } from "../types.js";
import { parseTypeScript, extractTypeScriptImports, extractTypeScriptExports } from "./typescript-parser.js";
import { parseWithTreeSitter, extractImportsTreeSitter, treeSitterSupported } from "./tree-sitter-parser.js";
import { parseFallback, extractImportsFallback, extractExportsFallback } from "./fallback-parser.js";
import { languageForFile, isSourceFile } from "../repository/scanner.js";

export interface ParsedFile {
  symbols: SymbolInfo[];
  imports: string[];
  exports: string[];
}

export async function parseFile(source: string, filePath: string, language?: string): Promise<ParsedFile> {
  const lang = language ?? languageForFile(filePath);
  if (lang === "typescript" || lang === "javascript") {
    return {
      symbols: parseTypeScript(source, filePath),
      imports: extractTypeScriptImports(source, filePath),
      exports: extractTypeScriptExports(source, filePath),
    };
  }

  // Tree-sitter (WASM) for the other supported languages.
  if (treeSitterSupported(lang)) {
    const symbols = await parseWithTreeSitter(source, lang, filePath);
    if (symbols) {
      const imports = await extractImportsTreeSitter(source, lang);
      return { symbols, imports, exports: [] };
    }
  }

  // Fallback.
  return {
    symbols: parseFallback(source, filePath, lang),
    imports: extractImportsFallback(source, lang),
    exports: extractExportsFallback(source, lang),
  };
}

export function canParse(language: string): boolean {
  return ["typescript", "javascript", "python", "go", "rust", "java", "c", "cpp", "csharp", "php"].includes(language);
}

export { isSourceFile, languageForFile };
