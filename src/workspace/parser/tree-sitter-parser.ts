/**
 * CODER — Tree-sitter symbol parser (optional, WASM-based).
 *
 * Provides symbols for the non-TypeScript languages (Python, Go, Rust,
 * Java, C, C++, C#, PHP) via web-tree-sitter + prebuilt WASM grammars.
 * Falls back gracefully when the WASM grammars are unavailable.
 */

import { createRequire } from "node:module";
import { type SymbolInfo, type SymbolKind } from "../types.js";

interface QuerySpec {
  kind: SymbolKind;
  /** Node types that produce this kind. */
  nodeTypes: string[];
  /** Child field holding the name (or "name" child). */
  nameField?: string;
  /** Use the identifier child for the name. */
  nameChild?: string;
  /** Method name prefix for methods (uses parent class name). */
  method?: boolean;
}

const GRAMMAR_QUERIES: Record<string, QuerySpec[]> = {
  python: [
    { kind: "function", nodeTypes: ["function_definition"], nameField: "name" },
    { kind: "class", nodeTypes: ["class_definition"], nameField: "name" },
    { kind: "method", nodeTypes: ["function_definition"], nameField: "name", method: true },
    { kind: "import", nodeTypes: ["import_statement", "import_from_statement"], nameChild: "module_name" },
  ],
  go: [
    { kind: "function", nodeTypes: ["function_declaration"], nameField: "name" },
    { kind: "method", nodeTypes: ["method_declaration"], nameField: "name", method: true },
    { kind: "type", nodeTypes: ["type_spec"], nameField: "name" },
    { kind: "import", nodeTypes: ["import_declaration"], nameChild: "interpreted_string_literal" },
  ],
  rust: [
    { kind: "function", nodeTypes: ["function_item"], nameField: "name" },
    { kind: "struct", nodeTypes: ["struct_item"], nameField: "name" },
    { kind: "enum", nodeTypes: ["enum_item"], nameField: "name" },
    { kind: "type", nodeTypes: ["type_item", "trait_item"], nameField: "name" },
    { kind: "import", nodeTypes: ["use_declaration"], nameChild: "scoped_identifier" },
  ],
  java: [
    { kind: "class", nodeTypes: ["class_declaration"], nameField: "name" },
    { kind: "interface", nodeTypes: ["interface_declaration"], nameField: "name" },
    { kind: "method", nodeTypes: ["method_declaration"], nameField: "name", method: true },
    { kind: "import", nodeTypes: ["import_declaration"], nameChild: "scoped_identifier" },
  ],
  c: [
    { kind: "function", nodeTypes: ["function_definition"], nameChild: "function_declarator" },
    { kind: "struct", nodeTypes: ["struct_specifier"], nameField: "name" },
    { kind: "type", nodeTypes: ["type_definition"], nameChild: "type_identifier" },
    { kind: "import", nodeTypes: ["preproc_include"], nameChild: "string_literal" },
  ],
  cpp: [
    { kind: "function", nodeTypes: ["function_definition"], nameChild: "function_declarator" },
    { kind: "class", nodeTypes: ["class_specifier"], nameField: "name" },
    { kind: "struct", nodeTypes: ["struct_specifier"], nameField: "name" },
    { kind: "import", nodeTypes: ["preproc_include"], nameChild: "string_literal" },
  ],
  csharp: [
    { kind: "class", nodeTypes: ["class_declaration"], nameField: "name" },
    { kind: "interface", nodeTypes: ["interface_declaration"], nameField: "name" },
    { kind: "method", nodeTypes: ["method_declaration"], nameField: "name", method: true },
    { kind: "import", nodeTypes: ["using_directive"], nameChild: "qualified_name" },
  ],
  php: [
    { kind: "function", nodeTypes: ["function_definition"], nameField: "name" },
    { kind: "class", nodeTypes: ["class_declaration"], nameField: "name" },
    { kind: "method", nodeTypes: ["method_declaration"], nameField: "name", method: true },
    { kind: "import", nodeTypes: ["namespace_use_declaration"], nameChild: "namespace_name" },
  ],
};

const GRAMMAR_NAMES: Record<string, string> = {
  python: "tree-sitter-python.wasm",
  go: "tree-sitter-go.wasm",
  rust: "tree-sitter-rust.wasm",
  java: "tree-sitter-java.wasm",
  c: "tree-sitter-c.wasm",
  cpp: "tree-sitter-cpp.wasm",
  csharp: "tree-sitter-c_sharp.wasm",
  php: "tree-sitter-php.wasm",
};

interface TsParser {
  Language: {
    load(wasm: Uint8Array): Promise<unknown>;
  };
  new (): {
    setLanguage(lang: unknown): void;
    parse(source: string): { rootNode: TsNode };
  };
}

interface TsNode {
  type: string;
  startPosition: { row: number; column: number };
  text: string;
  namedChildren: TsNode[];
  childForFieldName(name: string): TsNode | null;
}

let parserModule: TsParser | null | null = null; // null = not tried yet
const languageCache = new Map<string, unknown>();

async function loadParser(): Promise<TsParser | null> {
  if (parserModule !== null) return parserModule;
  try {
    const require = createRequire(import.meta.url);
    const mod = require("web-tree-sitter") as unknown as TsParser;
    await (mod as unknown as { init(): Promise<void> }).init();
    parserModule = mod;
    return mod;
  } catch {
    parserModule = null;
    return null;
  }
}

async function loadLanguage(mod: TsParser, language: string): Promise<unknown | undefined> {
  const cached = languageCache.get(language);
  if (cached) return cached;
  try {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve(`tree-sitter-wasms/out/${GRAMMAR_NAMES[language]}`);
    const { readFileSync } = await import("node:fs");
    const wasm = readFileSync(wasmPath);
    const lang = await mod.Language.load(wasm);
    languageCache.set(language, lang);
    return lang;
  } catch {
    return undefined;
  }
}

function findName(node: TsNode, spec: QuerySpec): string | undefined {
  if (spec.nameField) {
    const field = node.childForFieldName(spec.nameField) ?? node.childForFieldName(spec.nameField);
    if (field) return field.text.trim();
  }
  // Fall back to the first identifier-like named child.
  const identifierChild = node.namedChildren.find((c) => c.type.includes("identifier") || c.type.includes("name"));
  if (identifierChild) {
    if (identifierChild.type === "function_declarator") {
      const inner = identifierChild.namedChildren[0];
      return inner?.text ?? identifierChild.text;
    }
    return identifierChild.text.trim();
  }
  return undefined;
}

/**
 * Parse symbols with tree-sitter. Returns null when tree-sitter is not
 * available for this language (caller falls back).
 */
export async function parseWithTreeSitter(source: string, language: string, fileName: string): Promise<SymbolInfo[] | null> {
  const queries = GRAMMAR_QUERIES[language];
  if (!queries) return null;
  const mod = await loadParser();
  if (!mod) return null;
  const lang = await loadLanguage(mod, language);
  if (!lang) return null;

  const parser = new mod();
  parser.setLanguage(lang);
  const tree = parser.parse(source);
  const symbols: SymbolInfo[] = [];

  // Find class names first (for method naming).
  const classNames = new Map<TsNode, string>();
  const findClasses = (node: TsNode): void => {
    if ((node.type === "class_definition" || node.type === "class_declaration" || node.type === "class_specifier") && node.childForFieldName("name")) {
      classNames.set(node, node.childForFieldName("name")!.text.trim());
    }
    for (const child of node.namedChildren) findClasses(child);
  };
  findClasses(tree.rootNode);

  const isMethodClass = (node: TsNode): string | undefined => {
    // Walk up: method nodes' parents chain contains the class node.
    return undefined; // handled below via closest class ancestor
  };
  void isMethodClass;

  const visit = (node: TsNode, ancestors: TsNode[]): void => {
    for (const spec of queries) {
      if (!spec.nodeTypes.includes(node.type)) continue;
      const name = findName(node, spec);
      if (!name) continue;
      const line = node.startPosition.row + 1;
      const column = node.startPosition.column + 1;
      let symbolName = name;
      if (spec.method) {
        const classAncestor = ancestors.find((a) => classNames.has(a));
        if (classAncestor) symbolName = `${classNames.get(classAncestor)}.${name}`;
      }
      symbols.push({
        name: symbolName,
        kind: spec.kind === "struct" ? "class" : spec.kind,
        file: fileName,
        line,
        column,
        signature: node.text.split(/\r?\n/)[0]!.slice(0, 200),
      });
    }
    for (const child of node.namedChildren) visit(child, [...ancestors, node]);
  };
  visit(tree.rootNode, []);

  return dedupe(symbols);
}

function dedupe(symbols: SymbolInfo[]): SymbolInfo[] {
  const seen = new Set<string>();
  return symbols.filter((s) => {
    const key = `${s.kind}:${s.name}:${s.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Whether tree-sitter grammars exist for this language. */
export function treeSitterSupported(language: string): boolean {
  return language in GRAMMAR_QUERIES;
}

/** Import specifiers via tree-sitter (best effort). */
export async function extractImportsTreeSitter(source: string, language: string): Promise<string[]> {
  const queries = GRAMMAR_QUERIES[language];
  if (!queries) return [];
  const mod = await loadParser();
  if (!mod) return [];
  const lang = await loadLanguage(mod, language);
  if (!lang) return [];
  const parser = new mod();
  parser.setLanguage(lang);
  const tree = parser.parse(source);
  const imports: string[] = [];
  const visit = (node: TsNode): void => {
    if (node.type.endsWith("import") || node.type.includes("import") || node.type === "using_directive" || node.type === "preproc_include" || node.type === "use_declaration") {
      const spec = queries.find((q) => q.kind === "import");
      if (spec) {
        const name = findName(node, spec);
        if (name) {
          imports.push(name.replace(/['"]/g, "").split(/\s+/)[0] ?? name);
        }
      }
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(tree.rootNode);
  return imports;
}
