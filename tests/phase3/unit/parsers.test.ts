import { describe, expect, it } from "vitest";
import { parseTypeScript, extractTypeScriptImports } from "../../../src/workspace/parser/typescript-parser.js";
import { parseFallback, extractImportsFallback } from "../../../src/workspace/parser/fallback-parser.js";
import { languageForFile, isTestFile, globToRegex } from "../../../src/workspace/repository/scanner.js";

describe("language detection", () => {
  it("maps extensions to languages", () => {
    expect(languageForFile("src/index.ts")).toBe("typescript");
    expect(languageForFile("app.tsx")).toBe("typescript");
    expect(languageForFile("main.py")).toBe("python");
    expect(languageForFile("main.go")).toBe("go");
    expect(languageForFile("lib.rs")).toBe("rust");
    expect(languageForFile("Main.java")).toBe("java");
    expect(languageForFile("util.c")).toBe("c");
    expect(languageForFile("util.cpp")).toBe("cpp");
    expect(languageForFile("Program.cs")).toBe("csharp");
    expect(languageForFile("index.php")).toBe("php");
    expect(languageForFile("README.md")).toBe("text");
  });

  it("detects test files by naming convention", () => {
    expect(isTestFile("test/auth.test.ts")).toBe(true);
    expect(isTestFile("src/auth.spec.ts")).toBe(true);
    expect(isTestFile("test_util.py")).toBe(true);
    expect(isTestFile("util_test.go")).toBe(true);
    expect(isTestFile("src/auth.ts")).toBe(false);
  });
});

describe("gitignore globs", () => {
  it("converts glob patterns to regexes", () => {
    expect(globToRegex("node_modules").test("node_modules")).toBe(true);
    expect(globToRegex("**/*.log").test("a/b/c.log")).toBe(true);
    expect(globToRegex("dist/").test("dist")).toBe(false);
    expect(globToRegex("*.ts").test("index.ts")).toBe(true);
    expect(globToRegex("*.ts").test("index.js")).toBe(false);
  });
});

describe("TypeScript parser", () => {
  const source = `
/** Doc for greet. */
export function greet(name: string): string {
  return "hi " + name;
}

export interface User {
  id: number;
}

export class Greeter {
  private names: string[] = [];
  add(name: string): void {
    this.names.push(name);
  }
}

const VERSION = "1.0";

export { greet };
import { x } from "./other";
`;

  it("finds functions, interfaces, classes, methods, variables", () => {
    const symbols = parseTypeScript(source, "test.ts");
    const names = symbols.map((s) => `${s.kind}:${s.name}`);
    expect(names).toContain("function:greet");
    expect(names).toContain("interface:User");
    expect(names).toContain("class:Greeter");
    expect(names).toContain("method:Greeter.add");
    expect(names).toContain("variable:VERSION");
    const greet = symbols.find((s) => s.name === "greet");
    expect(greet?.line).toBe(3);
    expect(greet?.doc).toContain("Doc for greet");
  });

  it("extracts imports", () => {
    const imports = extractTypeScriptImports(source, "test.ts");
    expect(imports).toContain("./other");
  });
});

describe("fallback parser (multi-language)", () => {
  it("parses python functions and classes", () => {
    const symbols = parseFallback("def hello(name):\n    return name\n\nclass Foo:\n    pass\n", "a.py", "python");
    expect(symbols.map((s) => `${s.kind}:${s.name}`)).toEqual(expect.arrayContaining(["function:hello", "class:Foo"]));
  });

  it("parses go functions and types", () => {
    const symbols = parseFallback("func Compute(input string) string {\n\treturn input\n}\n\ntype Service struct {\n\tname string\n}\n", "a.go", "go");
    expect(symbols.map((s) => `${s.kind}:${s.name}`)).toEqual(expect.arrayContaining(["function:Compute", "type:Service"]));
  });

  it("parses rust functions", () => {
    const symbols = parseFallback("fn main() {\n    println!(\"hi\");\n}\n\nstruct Point {\n    x: i32,\n}\n", "a.rs", "rust");
    expect(symbols.map((s) => `${s.kind}:${s.name}`)).toEqual(expect.arrayContaining(["function:main", "class:Point"]));
  });

  it("parses java methods and classes", () => {
    const symbols = parseFallback("public class App {\n    public void run() {\n    }\n}\n", "App.java", "java");
    expect(symbols.map((s) => `${s.kind}:${s.name}`)).toEqual(expect.arrayContaining(["class:App", "method:run"]));
  });

  it("extracts language imports", () => {
    expect(extractImportsFallback("import os\nfrom pathlib import Path\n", "python")).toEqual(["os", "pathlib"]);
    expect(extractImportsFallback("import java.util.List;", "java")).toEqual(["java.util.List"]);
    expect(extractImportsFallback('using System.Text;', "csharp")).toEqual(["System.Text"]);
    expect(extractImportsFallback('#include <stdio.h>', "c")).toEqual(["stdio.h"]);
  });
});
