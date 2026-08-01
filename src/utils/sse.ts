/**
 * CODER — Server-Sent Events (SSE) parsing.
 *
 * `SseDecoder` consumes string chunks and emits complete SSE events, which
 * is exactly what streaming chat responses need (OpenAI/OpenRouter SSE,
 * Anthropic SSE, Gemini `alt=sse`). `parseSse` is a convenience wrapper for
 * whole-body parsing (unit tests, non-streaming edge cases).
 */

export interface SseEvent {
  /** Event name (the `event:` field), when present. */
  event?: string;
  /** Event data (the `data:` field, multi-line joined with "\n"). */
  data: string;
}

export const SSE_DONE = "[DONE]";

export class SseDecoder {
  private buffer = "";

  /** Feed a chunk of raw body text; returns any complete events. */
  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    let idx: number;
    while ((idx = this.buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2); // strips "\n\n" (works for \r\n too)
      const parsed = parseEventBlock(block);
      if (parsed) events.push(parsed);
    }
    return events;
  }

  /** Flush any trailing event without a terminating blank line. */
  end(): SseEvent[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    if (rest === "") return [];
    const parsed = parseEventBlock(rest);
    return parsed ? [parsed] : [];
  }
}

/** Parse a whole SSE body from string chunks (convenience, tests). */
export function* parseSse(chunks: Iterable<string>): Generator<SseEvent> {
  const decoder = new SseDecoder();
  for (const chunk of chunks) {
    for (const event of decoder.push(chunk)) yield event;
  }
  for (const event of decoder.end()) yield event;
}

function parseEventBlock(block: string): SseEvent | null {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(":")) continue; // comment
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}
