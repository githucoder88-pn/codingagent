import { describe, expect, it } from "vitest";
import { estimateTokens, humanBytes, renderTable, truncate, parseBoolEnv, pct } from "../../src/utils/format.js";

describe("format helpers", () => {
  it("estimates tokens as chars/4", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("formats byte sizes", () => {
    expect(humanBytes(512)).toBe("512 B");
    expect(humanBytes(2048)).toBe("2.0 KB");
    expect(humanBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(humanBytes(-1)).toBe("—");
  });

  it("truncates long strings", () => {
    expect(truncate("hello", 10)).toBe("hello");
    expect(truncate("hello world", 5)).toBe("hell…");
  });

  it("parses boolean env values", () => {
    expect(parseBoolEnv("1")).toBe(true);
    expect(parseBoolEnv("FALSE")).toBe(false);
    expect(parseBoolEnv("yes")).toBe(true);
    expect(parseBoolEnv("maybe")).toBeUndefined();
    expect(parseBoolEnv(undefined)).toBeUndefined();
  });

  it("renders percentages with unknown parts as dash", () => {
    expect(pct(5, 10)).toBe("50%");
    expect(pct(undefined, 10)).toBe("—");
    expect(pct(5, 0)).toBe("—");
  });
});

describe("renderTable", () => {
  it("aligns columns by content width", () => {
    const table = renderTable(["A", "BBB"], [["1", "2"], ["longer", "x"]]);
    const lines = table.split("\n");
    expect(lines[0]).toBe("A       BBB");
    expect(lines[2]).toBe("1       2");
    expect(lines[3]).toBe("longer  x");
  });

  it("returns empty string for no rows", () => {
    expect(renderTable(["A"], [])).toBe("");
  });
});
