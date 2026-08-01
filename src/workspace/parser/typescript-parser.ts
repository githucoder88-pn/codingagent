/**
 * CODER — TypeScript/JavaScript symbol parser.
 *
 * Uses the TypeScript compiler API to extract functions, classes,
 * interfaces, enums, types, imports, exports, methods and variables with
 * accurate locations and signatures.
 */

import * as ts from "typescript";
import { type SymbolInfo } from "../types.js";

export function parseTypeScript(source: string, fileName: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const lineOf = (pos: number): number => sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
  const colOf = (pos: number): number => sourceFile.getLineAndCharacterOfPosition(pos).character + 1;

  const docFor = (node: ts.Node): string | undefined => {
    const range = ts.getLeadingCommentRanges(source, node.getFullStart());
    if (!range) return undefined;
    for (const comment of range) {
      const text = source.slice(comment.pos, comment.end);
      if (text.startsWith("/**")) {
        return text.replace(/^\/\*\*/, "").replace(/\*\/$/, "").split(/\r?\n/).map((l) => l.replace(/^\s*\*?\s?/, "")).filter(Boolean).join(" ").slice(0, 300);
      }
    }
    return undefined;
  };

  const signatureFor = (node: ts.Node): string | undefined => {
    try {
      return source.slice(node.getStart(), node.getEnd()).split(/\r?\n/)[0]!.slice(0, 200);
    } catch {
      return undefined;
    }
  };

  const visit = (node: ts.Node): void => {
    const kind = ts.SyntaxKind[node.kind];

    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      const name = (node as ts.FunctionDeclaration).name?.text;
      if (name) {
        symbols.push({
          name,
          kind: "function",
          file: fileName,
          line: lineOf(node.getStart()),
          column: colOf(node.getStart()),
          signature: signatureFor(node),
          doc: docFor(node),
        });
      }
    } else if (ts.isClassDeclaration(node)) {
      const name = node.name?.text;
      if (name) {
        symbols.push({
          name,
          kind: "class",
          file: fileName,
          line: lineOf(node.getStart()),
          column: colOf(node.getStart()),
          signature: signatureFor(node),
          doc: docFor(node),
        });
      }
    } else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
      const name = node.name?.text;
      if (name) {
        symbols.push({
          name,
          kind: ts.isInterfaceDeclaration(node) ? "interface" : ts.isEnumDeclaration(node) ? "enum" : "type",
          file: fileName,
          line: lineOf(node.getStart()),
          column: colOf(node.getStart()),
          signature: signatureFor(node),
          doc: docFor(node),
        });
      }
    } else if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const name = (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) ? node.moduleSpecifier.text : undefined;
      if (name) {
        symbols.push({
          name,
          kind: node.kind === ts.SyntaxKind.ImportDeclaration ? "import" : "export",
          file: fileName,
          line: lineOf(node.getStart()),
          column: colOf(node.getStart()),
          signature: `import/export from "${name}"`,
        });
      }
    } else if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
      const name = node.name && ts.isIdentifier(node.name) ? node.name.text : undefined;
      const parentClass = node.parent && ts.isClassDeclaration(node.parent) ? node.parent.name?.text : undefined;
      if (name) {
        symbols.push({
          name: parentClass ? `${parentClass}.${name}` : name,
          kind: "method",
          file: fileName,
          line: lineOf(node.getStart()),
          column: colOf(node.getStart()),
          signature: signatureFor(node),
          doc: docFor(node),
        });
      }
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      // Only top-level variables (module scope) to avoid noise.
      let isModuleScope = true;
      let parent: ts.Node | undefined = node.parent;
      while (parent) {
        if (ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isMethodDeclaration(parent)) {
          isModuleScope = false;
          break;
        }
        if (ts.isBlock(parent)) {
          if (!parent.parent || !ts.isSourceFile(parent.parent)) {
            isModuleScope = false;
            break;
          }
        }
        parent = parent.parent;
      }
      if (isModuleScope) {
        symbols.push({
          name: node.name.text,
          kind: "variable",
          file: fileName,
          line: lineOf(node.getStart()),
          column: colOf(node.getStart()),
          signature: signatureFor(node),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return symbols;
}

/** Extract import specifiers (module names) from a TS/JS file. */
export function extractTypeScriptImports(source: string, fileName: string): string[] {
  const imports: string[] = [];
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (spec && ts.isStringLiteral(spec)) imports.push(spec.text);
    } else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (ts.isExternalModuleReference(ref) && ref.expression && ts.isStringLiteral(ref.expression)) imports.push(ref.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}

/** Extract exported names from a TS/JS file. */
export function extractTypeScriptExports(source: string, fileName: string): string[] {
  const exports: string[] = [];
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isExportDeclaration(node)) {
      const clause = node.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) exports.push(element.name.text);
      }
    } else if (ts.isExportAssignment(node)) {
      // export default <name> / export = <name>
      const expr = node.expression;
      if (expr && ts.isIdentifier(expr)) exports.push(expr.text);
    } else if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
      if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) && node.name) {
        exports.push(node.name.text);
      }
    } else if (ts.isVariableStatement(node)) {
      if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) exports.push(declaration.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...new Set(exports)];
}
