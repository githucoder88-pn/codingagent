/**
 * CODER — HTTP client.
 *
 * Thin wrapper over the global `fetch` that adds timeouts and maps transport
 * failures onto the CoderError hierarchy. `fetchImpl` is injectable so tests
 * can stub the network.
 */

import { HTTP_TIMEOUT_MS } from "../core/constants/index.js";
import { NetworkError } from "../core/errors/index.js";

export interface HttpResponse {
  ok: boolean;
  status: number;
  headers: Headers;
  /** Parsed JSON body (null when the body is not JSON). */
  body: unknown;
}

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Timeout for the request (or initial connection for streams). */
  timeoutMs?: number;
}

export class HttpClient {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly defaultTimeoutMs: number = HTTP_TIMEOUT_MS,
  ) {}

  /** Perform a request and parse the JSON body. */
  async request(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
    const res = await this.requestRaw(url, options);
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, headers: res.headers, body };
  }

  /** Perform a request and return the raw Response (streaming callers). */
  async requestRaw(url: string, options: HttpRequestOptions = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? this.defaultTimeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: options.method ?? "GET",
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
      });
    } catch (err) {
      const cause = err as Error;
      if (cause.name === "AbortError") {
        throw new NetworkError(`Request timed out after ${options.timeoutMs ?? this.defaultTimeoutMs} ms: ${url}`);
      }
      throw new NetworkError(`Network error while requesting ${url}: ${cause.message}`, { cause });
    } finally {
      clearTimeout(timer);
    }
    return res;
  }
}
