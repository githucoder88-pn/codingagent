/**
 * CODER — Babel symbol parser (JS/JSX).
 *
 * Babel handles plain JavaScript, JSX and Flow-typed code that the
 * TypeScript compiler API sometimes chokes on. Used as the primary parser
 * for `.js`/`.jsx`/`.mjs`/`.cjs` files (the TypeScript API remains primary
 * for `.ts`/`.tsx`). Falls back to the TS API when parsing fails.
 */

import { parse, type ParserOptions } from "@babel/parser";
import traverseModule from "@babel/traverse";
import type { SymbolInfo } from "../types.js";

// @babel/traverse ships both CJS + ESM; resolve the callable either way.
type TraverseFn = (ast: import("@babel/types").Node, visitors: Record<string, unknown>) => void;
const traverse = (traverseModule as unknown as { default?: TraverseFn }).default ?? (traverseModule as unknown as TraverseFn);

const BASE_PLUGINS: ParserOptions["plugins"] = [
  "jsx",
  "classProperties",
  "classPrivateProperties",
  "classPrivateMethods",
  "dynamicImport",
  "importMeta",
  "optionalChaining",
  "nullishCoalescingOperator",
  "objectRestSpread",
  "topLevelAwait",
];

function parseOptions(dialect: "flow" | "typescript" | "none"): ParserOptions {
  // "flow" and "typescript" plugins cannot be combined; pick by file pragma.
  const plugins = [...(BASE_PLUGINS as string[])];
  if (dialect === "flow") plugins.push("flow");
  if (dialect === "typescript") plugins.push("typescript");
  return {
    sourceType: "unambiguous",
    allowReturnOutsideFunction: true,
    errorRecovery: true,
    plugins: plugins as ParserOptions["plugins"],
  };
}

/** Choose a dialect from the file pragma (// @flow) or the file extension. */
function detectDialect(source: string, fileName: string): "flow" | "typescript" | "none" {
  if (source.slice(0, 200).includes("@flow")) return "flow";
  if (fileName.endsWith(".ts") || fileName.endsWith(".tsx")) return "typescript";
  return "none";
}

interface BabelNode {
  type: string;
  loc?: { start: { line: number; column: number } };
  leadingComments?: Array<{ value?: string }>;
  id?: { name?: string };
  key?: { name?: string };
  name?: string;
  [key: string]: unknown;
}

function docFor(node: BabelNode): string | undefined {
  const comments = node.leadingComments;
  if (!comments || comments.length === 0) return undefined;
  const comment = comments[0];
  if (!comment) return undefined;
  const value = comment.value ?? "";
  if (value.startsWith("*")) {
    return value.replace(/^\*/, "").split(/\r?\n/).map((l) => l.replace(/^\s*\*?\s?/, "")).filter(Boolean).join(" ").slice(0, 300);
  }
  return undefined;
}

function parseWithDialects(source: string, fileName: string): import("@babel/types").File | null {
  const primary = detectDialect(source, fileName);
  const attempts: Array<"flow" | "typescript" | "none"> =
    primary === "none" ? ["none", "flow", "typescript"] : [primary, "none"];
  for (const dialect of attempts) {
    try {
      return parse(source, parseOptions(dialect));
    } catch {
      /* try next dialect */
    }
  }
  return null;
}

/** Parse a JS/JSX source into symbols. Returns null when Babel cannot parse. */
export function parseWithBabel(source: string, fileName: string): SymbolInfo[] | null {
  const ast = parseWithDialects(source, fileName);
  if (!ast) return null;
  const symbols: SymbolInfo[] = [];
  const push = (node: BabelNode, kind: SymbolInfo["kind"], name?: string): void => {
    const symbolName = name ?? node.id?.name ?? node.key?.name ?? (node.type === "ImportDeclaration" ? undefined : undefined);
    if (!symbolName) return;
    symbols.push({
      name: symbolName,
      kind,
      file: fileName,
      line: node.loc?.start.line ?? 0,
      column: (node.loc?.start.column ?? 0) + 1,
      signature: source.slice(0, 0) || undefined, // filled below when cheap
      doc: docFor(node),
    });
  };

  traverse(ast, {
    FunctionDeclaration(path: { node: BabelNode }) {
      push(path.node, "function");
    },
    FunctionExpression(path: { node: BabelNode }) {
      push(path.node, "function");
    },
    ArrowFunctionExpression(path: { node: BabelNode }) {
      push(path.node, "function");
    },
    ClassDeclaration(path: { node: BabelNode }) {
      push(path.node, "class");
    },
    ClassMethod(path: { node: BabelNode }) {
      const name = path.node.key?.name;
      if (name) push(path.node, "method", name);
    },
    ObjectMethod(path: { node: BabelNode }) {
      const name = path.node.key?.name;
      if (name) push(path.node, "method", name);
    },
    TSInterfaceDeclaration(path: { node: BabelNode }) {
      push(path.node, "interface");
    },
    TSTypeAliasDeclaration(path: { node: BabelNode }) {
      push(path.node, "type");
    },
    TSEnumDeclaration(path: { node: BabelNode }) {
      push(path.node, "enum");
    },
    ImportDeclaration(path: { node: BabelNode }) {
      const spec = (path.node as unknown as { source?: { value?: string } }).source?.value;
      if (spec) push(path.node, "import", spec);
    },
    ExportNamedDeclaration(path: { node: BabelNode }) {
      const spec = (path.node as unknown as { source?: { value?: string } }).source?.value;
      if (spec) push(path.node, "export", spec);
    },
  });

  // Fill signatures from the source text (cheap line-based).
  const lines = source.split(/\r?\n/);
  for (const symbol of symbols) {
    const line = lines[symbol.line - 1];
    if (line) symbol.signature = line.trim().slice(0, 200);
  }
  return symbols;
}

/** Extract import specifiers with Babel. */
export function extractBabelImports(source: string, fileName: string): string[] | null {
  const ast = parseWithDialects(source, fileName);
  if (!ast) return null;
  const imports: string[] = [];
  traverse(ast, {
    ImportDeclaration(path: { node: { source?: { value?: string } } }) {
      const value = path.node.source?.value;
      if (value) imports.push(value);
    },
    ExportNamedDeclaration(path: { node: { source?: { value?: string } } }) {
      const value = path.node.source?.value;
      if (value) imports.push(value);
    },
    CallExpression(path: { node: { callee?: { type?: string; name?: string }; arguments?: Array<{ value?: string }> } }) {
      if (path.node.callee?.type === "Import" && path.node.arguments?.[0]?.value) {
        imports.push(path.node.arguments[0].value);
      }
    },
  });
  return [...new Set(imports)];
}

/** Extract exported names with Babel. */
export function extractBabelExports(source: string, fileName: string): string[] | null {
  const ast = parseWithDialects(source, fileName);
  if (!ast) return null;
  const exports: string[] = [];
  traverse(ast, {
    ExportNamedDeclaration(path: { node: BabelNode }) {
      const declaration = path.node.declaration as BabelNode | null;
      if (declaration) {
        if (declaration.id?.name) exports.push(declaration.id.name);
        const declarations = (declaration as unknown as { declarations?: Array<{ id?: { name?: string } }> }).declarations;
        if (declarations) {
          for (const d of declarations) {
            if (d.id?.name) exports.push(d.id.name);
          }
        }
      }
      const specifiers = (path.node as unknown as { specifiers?: Array<{ exported?: { name?: string } }> }).specifiers;
      if (specifiers) {
        for (const s of specifiers) {
          if (s.exported?.name) exports.push(s.exported.name);
        }
      }
    },
    ExportDefaultDeclaration(path: { node: BabelNode }) {
      const declaration = path.node.declaration as BabelNode | null;
      if (declaration?.id?.name) exports.push(declaration.id.name);
      else exports.push("default");
    },
  });
  return [...new Set(exports)];
}
