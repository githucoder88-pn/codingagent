import { describe, expect, it } from "vitest";
import { levelAllows, checkPermission } from "../../../src/execution/permissions.js";
import { parseToolCall, TOOL_PROTOCOL } from "../../../src/execution/agent.js";
import { getTool } from "../../../src/tools/registry.js";

describe("permission engine", () => {
  it("orders levels safe < balanced < full-auto", () => {
    expect(levelAllows("safe", "safe")).toBe(true);
    expect(levelAllows("safe", "balanced")).toBe(false);
    expect(levelAllows("balanced", "balanced")).toBe(true);
    expect(levelAllows("balanced", "full-auto")).toBe(false);
    expect(levelAllows("full-auto", "full-auto")).toBe(true);
    expect(levelAllows("full-auto", "safe")).toBe(true);
  });

  it("denies without approval and allows with one-time approval", async () => {
    const writeTool = getTool("write_file")!;
    expect(writeTool.level).toBe("balanced");

    const denied = await checkPermission(writeTool, "safe", { interactive: false });
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain("balanced");

    const approved = await checkPermission(writeTool, "safe", {
      interactive: true,
      ask: async () => true,
    });
    expect(approved.allowed).toBe(true);
  });

  it("grants safe tools at every level", async () => {
    const readTool = getTool("read_file")!;
    expect((await checkPermission(readTool, "safe")).allowed).toBe(true);
    expect((await checkPermission(readTool, "full-auto")).allowed).toBe(true);
  });
});

describe("agent tool-call protocol", () => {
  it("parses fenced JSON tool calls", () => {
    const call = parseToolCall('Here is what I will do:\n```json\n{"tool":"read_file","params":{"path":"src/index.ts"}}\n```');
    expect(call).toEqual({ tool: "read_file", params: { path: "src/index.ts" } });
  });

  it("parses bare JSON tool calls", () => {
    expect(parseToolCall('{"tool":"git_status","params":{}}')).toEqual({ tool: "git_status", params: {} });
  });

  it("rejects non-tool JSON and unknown tools", () => {
    expect(parseToolCall('{"tool":"nope","params":{}}')).toBeNull();
    expect(parseToolCall("just a normal answer")).toBeNull();
    expect(parseToolCall('{"hello":"world"}')).toBeNull();
  });

  it("includes the tool protocol marker and schema in the system prompt", () => {
    expect(TOOL_PROTOCOL).toContain("CODER");
    expect(TOOL_PROTOCOL).toContain('"tool":"<tool_id>"');
    expect(TOOL_PROTOCOL).toContain("read_file");
  });
});
