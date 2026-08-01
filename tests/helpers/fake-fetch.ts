/**
 * Test helper: an in-memory fetch implementation that routes requests to
 * canned responses and records everything for assertions.
 */

import { ReadableStream } from "node:stream/web";

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export type Responder = (req: RecordedRequest) => Response;

export class FakeFetch {
  readonly requests: RecordedRequest[] = [];
  private routes: Array<{ match: (url: string) => boolean; respond: Responder }> = [];

  /** Route: url predicate + responder. Later routes win. */
  route(match: (url: string) => boolean, respond: Responder): void {
    this.routes.push({ match, respond });
  }

  /** Convenience: respond with JSON for any request matching the url. */
  json(urlMatch: string | RegExp, body: unknown, status = 200, headers: Record<string, string> = {}): void {
    this.route(
      (url) => (typeof urlMatch === "string" ? url.includes(urlMatch) : urlMatch.test(url)),
      () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json", ...headers },
        }),
    );
  }

  /** Convenience: respond with an SSE stream. */
  sse(urlMatch: string | RegExp, events: Array<{ event?: string; data: string }>, status = 200): void {
    const body = events.map((e) => `${e.event ? `event: ${e.event}\n` : ""}data: ${e.data}\n\n`).join("");
    this.route(
      (url) => (typeof urlMatch === "string" ? url.includes(urlMatch) : urlMatch.test(url)),
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(body));
              controller.close();
            },
          }),
          { status, headers: { "content-type": "text/event-stream" } },
        ),
    );
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers as Record<string, string>) ?? {})) {
      headers[k.toLowerCase()] = String(v);
    }
    const body = typeof init?.body === "string" ? init.body : null;
    const recorded: RecordedRequest = { url, method, headers, body };
    this.requests.push(recorded);

    for (let i = this.routes.length - 1; i >= 0; i -= 1) {
      const { match, respond } = this.routes[i]!;
      if (match(url)) return respond(recorded);
    }
    return new Response(JSON.stringify({ error: { message: `no route for ${url}` } }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };

  last(): RecordedRequest | undefined {
    return this.requests[this.requests.length - 1];
  }

  byUrl(part: string): RecordedRequest[] {
    return this.requests.filter((r) => r.url.includes(part));
  }
}
