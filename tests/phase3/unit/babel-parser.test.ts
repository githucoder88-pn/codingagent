import { describe, expect, it } from "vitest";
import { parseWithBabel, extractBabelImports, extractBabelExports } from "../../../src/workspace/parser/babel-parser.js";
import { parseFile } from "../../../src/workspace/parser/index.js";

describe("Babel parser (JS/JSX)", () => {
  it("parses plain JavaScript symbols", () => {
    const source = `
// plain js
function add(a, b) {
  return a + b;
}
const VALUE = 42;
class Calculator {
  multiply(a, b) {
    return a * b;
  }
}
`;
    const symbols = parseWithBabel(source, "calc.js");
    expect(symbols).not.toBeNull();
    expect(symbols!.map((s) => `${s.kind}:${s.name}`)).toEqual(
      expect.arrayContaining(["function:add", "class:Calculator", "method:multiply"]),
    );
  });

  it("parses JSX components and functions", () => {
    const source = `
import React from "react";
export function Button(props) {
  return <button onClick={props.onClick}>{props.label}</button>;
}
export default function App() {
  return <Button label="Hi" />;
}
`;
    const symbols = parseWithBabel(source, "App.jsx");
    expect(symbols).not.toBeNull();
    expect(symbols!.map((s) => `${s.kind}:${s.name}`)).toEqual(expect.arrayContaining(["function:Button", "function:App"]));
    expect(extractBabelImports(source, "App.jsx")).toContain("react");
    expect(extractBabelExports(source, "App.jsx")).toEqual(expect.arrayContaining(["Button", "App"]));
  });

  it("parses Flow-typed code that the TS API would reject", () => {
    const source = `
// @flow
function greet(name: string): string {
  return "hi " + name;
}
type Props = { label: string };
`;
    const symbols = parseWithBabel(source, "flow.js");
    expect(symbols).not.toBeNull();
    expect(symbols!.map((s) => s.kind)).toContain("function");
  });

  it("extracts named + default exports", () => {
    const source = `
export const A = 1;
export function b() {}
export { c };
export default function d() {}
`;
    const exports = extractBabelExports(source, "m.js");
    expect(exports).toEqual(expect.arrayContaining(["A", "b", "c", "d"]));
  });

  it("returns null for unparseable input (caller falls back)", () => {
    expect(parseWithBabel("function (", "broken.js")).toBeNull();
    expect(extractBabelImports("function (", "broken.js")).toBeNull();
  });
});

describe("parseFile dispatch (Babel for JS, TS API for TS)", () => {
  it("uses Babel for .js and the TS API for .ts", async () => {
    const js = await parseFile("export function hi() {}\n", "x.js");
    expect(js.symbols.map((s) => s.name)).toContain("hi");

    const ts = await parseFile("export function hi(): void {}\n", "x.ts");
    expect(ts.symbols.map((s) => s.name)).toContain("hi");
    expect(ts.symbols[0]?.kind).toBe("function");
  });

  it("extracts JS imports/exports via Babel", async () => {
    const parsed = await parseFile(
      'import { a } from "./a";\nexport function b() {}\n',
      "mod.js",
    );
    expect(parsed.imports).toContain("./a");
    expect(parsed.exports).toContain("b");
  });
});
