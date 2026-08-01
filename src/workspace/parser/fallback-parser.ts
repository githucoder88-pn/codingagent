/**
 * CODER — lightweight fallback symbol parser.
 *
 * Regex-based extraction for any language where neither the TypeScript
 * compiler API nor tree-sitter applies. Detects functions, classes,
 * methods, interfaces and import statements with permissive patterns.
 * Used as the last resort so the indexer always produces something.
 */

import { type SymbolInfo } from "../types.js";

interface Pattern {
  kind: SymbolInfo["kind"];
  regex: RegExp;
  /** Index of the capture group holding the name. */
  nameGroup: number;
  /** Optional language filter. */
  language?: string;
}

const PATTERNS: Pattern[] = [
  // Python
  { kind: "function", regex: /^\s*def\s+([A-Za-z_]\w*)\s*\(/gm, nameGroup: 1, language: "python" },
  { kind: "class", regex: /^\s*class\s+([A-Za-z_]\w*)\s*(?:\(|:)/gm, nameGroup: 1, language: "python" },
  // Go
  { kind: "function", regex: /^func\s+([A-Za-z_]\w*)\s*\(/gm, nameGroup: 1, language: "go" },
  { kind: "method", regex: /^func\s+\([^)]*\)\s+([A-Za-z_]\w*)\s*\(/gm, nameGroup: 1, language: "go" },
  { kind: "type", regex: /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface|map|\[)/gm, nameGroup: 1, language: "go" },
  // Rust
  { kind: "function", regex: /^fn\s+([a-z_]\w*)\s*[<(]/gm, nameGroup: 1, language: "rust" },
  { kind: "struct", regex: /^struct\s+([A-Z]\w*)/gm, nameGroup: 1, language: "rust" },
  { kind: "enum", regex: /^enum\s+([A-Z]\w*)/gm, nameGroup: 1, language: "rust" },
  // Java / C# / PHP / C / C++
  { kind: "class", regex: /^\s*(?:public|private|protected|abstract|final|static|\s)*class\s+([A-Za-z_]\w*)/gm, nameGroup: 1 },
  { kind: "interface", regex: /^\s*(?:public|private|protected|\s)*interface\s+([A-Za-z_]\w*)/gm, nameGroup: 1 },
  { kind: "method", regex: /^\s*(?:public|private|protected|static|final|async|override|virtual|\s)*[\w<>[\],\s]+\s+([a-zA-Z_]\w*)\s*\([^;{]*\)\s*(?:throws\s+[\w.]+)?\s*\{/gm, nameGroup: 1 },
  // C/C++ free functions
  { kind: "function", regex: /^(?:static|inline|extern|const|unsigned|signed|long|short|void|int|char|float|double|bool|size_t|auto|struct|enum)\s+[\w*&]+\s+([a-zA-Z_]\w*)\s*\([^;]*\)\s*\{/gm, nameGroup: 1, language: "c" },
  { kind: "function", regex: /^(?:static|inline|extern|const|unsigned|signed|long|short|void|int|char|float|double|bool|size_t|auto|std::[\w:]+|\w+::\w+)\s+[\w*&<>:]+?\s+([a-zA-Z_]\w*)\s*\([^;]*\)\s*\{/gm, nameGroup: 1, language: "cpp" },
  // PHP
  { kind: "function", regex: /^\s*(?:public|private|protected|static|final|\s)*function\s+([A-Za-z_]\w*)\s*\(/gm, nameGroup: 1, language: "php" },
  { kind: "class", regex: /^\s*(?:abstract|final|\s)*class\s+([A-Za-z_]\w*)/gm, nameGroup: 1, language: "php" },
  // Generic (any language)
  { kind: "function", regex: /^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/gm, nameGroup: 1 },
  { kind: "class", regex: /^\s*class\s+([A-Za-z_$][\w$]*)/gm, nameGroup: 1 },
  { kind: "interface", regex: /^\s*interface\s+([A-Za-z_$][\w$]*)/gm, nameGroup: 1 },
  { kind: "type", regex: /^\s*type\s+([A-Za-z_]\w*)\s*=/gm, nameGroup: 1 },
];

const IMPORT_PATTERNS: Array<{ language?: string; regex: RegExp }> = [
  { language: "python", regex: /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm },
  { language: "go", regex: /^\s*"([^"]+)"/gm },
  { language: "java", regex: /^\s*import\s+(?:static\s+)?([\w.]+);/gm },
  { language: "csharp", regex: /^\s*using\s+([\w.]+)\s*;/gm },
  { language: "php", regex: /^\s*use\s+([\\\w]+);/gm },
  { language: "cpp", regex: /^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm },
  { language: "c", regex: /^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm },
  { language: "rust", regex: /^\s*use\s+([\w:]+)/gm },
];

export function parseFallback(source: string, fileName: string, language: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  const lines = source.split(/\r?\n/);

  for (const pattern of PATTERNS) {
    if (pattern.language && pattern.language !== language) continue;
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(source)) !== null) {
      const name = match[pattern.nameGroup];
      if (!name) continue;
      const prefix = source.slice(0, match.index);
      const line = prefix.split(/\r?\n/).length;
      symbols.push({
        name,
        kind: pattern.kind === "struct" ? "class" : pattern.kind,
        file: fileName,
        line,
        column: match.index - prefix.lastIndexOf("\n"),
        signature: match[0].slice(0, 200),
      });
    }
  }

  // Dedupe identical (kind, name, line).
  const seen = new Set<string>();
  return symbols.filter((s) => {
    const key = `${s.kind}:${s.name}:${s.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractImportsFallback(source: string, language: string): string[] {
  const imports: string[] = [];
  for (const pattern of IMPORT_PATTERNS) {
    if (pattern.language && pattern.language !== language) continue;
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(source)) !== null) {
      const value = match[1] ?? match[2];
      if (value) imports.push(value.split(/\s+/)[0]!.replace(/["';]/g, ""));
    }
  }
  return [...new Set(imports)];
}

export function extractExportsFallback(source: string, language: string): string[] {
  const exports: string[] = [];
  if (language === "python") {
    for (const m of source.matchAll(/^(?:def|class)\s+([A-Za-z_]\w*)/gm)) exports.push(m[1]!);
  } else if (language === "go" || language === "rust") {
    for (const m of source.matchAll(/^func\s+([A-Z]\w*)|^fn\s+([A-Z]\w*)|^struct\s+([A-Z]\w*)|^enum\s+([A-Z]\w*)/gm)) {
      const name = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (name) exports.push(name);
    }
  } else {
    for (const m of source.matchAll(/^export\s+(?:default\s+)?(?:class|function|interface|type|const|let|var)?\s*([A-Za-z_$][\w$]*)/gm)) {
      if (m[1]) exports.push(m[1]!);
    }
    for (const m of source.matchAll(/^export\s*\{([^}]+)\}/gm)) {
      for (const part of m[1]!.split(",")) exports.push(part.trim().split(/\s+as\s+/)[0]!.trim());
    }
  }
  return [...new Set(exports.filter(Boolean))];
}
