import { describe, expect, it } from "vitest";
import { SseDecoder, parseSse, SSE_DONE } from "../../src/utils/sse.js";

describe("SseDecoder", () => {
  it("parses events split across arbitrary chunk boundaries", () => {
    const decoder = new SseDecoder();
    const chunks = ['data: {"a":1}\n\ndata: {"b":', "2}\n\ndata: [DONE]\n\n"];
    const events = chunks.flatMap((c) => decoder.push(c));
    expect(events).toHaveLength(3);
    expect(events[0]?.data).toBe('{"a":1}');
    expect(events[1]?.data).toBe('{"b":2}');
    expect(events[2]?.data).toBe(SSE_DONE);
  });

  it("handles CRLF line endings", () => {
    const decoder = new SseDecoder();
    const events = decoder.push("event: delta\r\ndata: hello\r\n\r\n");
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe("delta");
    expect(events[0]?.data).toBe("hello");
  });

  it("flushes a trailing event without a blank line", () => {
    const decoder = new SseDecoder();
    decoder.push("data: tail");
    const events = decoder.end();
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toBe("tail");
  });

  it("ignores comments and unknown fields", () => {
    const decoder = new SseDecoder();
    const events = decoder.push(": ping\ndata: x\nfoo: bar\n\n");
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toBe("x");
  });

  it("joins multi-line data fields", () => {
    const decoder = new SseDecoder();
    const events = decoder.push("data: line1\ndata: line2\n\n");
    expect(events[0]?.data).toBe("line1\nline2");
  });
});

describe("parseSse", () => {
  it("parses whole bodies from string chunks", () => {
    const events = [...parseSse(["data: a\n\ndata: b\n\n"])];
    expect(events.map((e) => e.data)).toEqual(["a", "b"]);
  });
});
