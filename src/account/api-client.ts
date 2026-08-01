/**
 * CODER CLI — backend API client.
 *
 * Thin fetch wrapper around the Phase 2 control plane. Base URL resolution:
 *   CODER_API_URL env → session.serverUrl → http://127.0.0.1:8747
 */

import { API_DEFAULT_PORT, API_PREFIX } from "../../shared/src/index.js";
import { AuthError, NetworkError } from "../core/errors/index.js";
import { loadSession } from "./session-store.js";

/** The backend URL implied by the environment (CODER_API_URL wins). */
export function defaultServerUrl(): string {
  const url = process.env.CODER_API_URL?.trim();
  if (url) return url;
  const port = Number(process.env.CODER_API_PORT ?? API_DEFAULT_PORT);
  return `http://127.0.0.1:${Number.isFinite(port) ? port : API_DEFAULT_PORT}`;
}

export function resolveServerUrl(): string {
  return defaultServerUrl() || loadSession()?.serverUrl || defaultServerUrl();
}

export interface ApiResult<T> {
  status: number;
  body: T;
}

export class ApiClient {
  constructor(
    private readonly serverUrl: string,
    private readonly token?: string,
  ) {}

  static fromSession(): ApiClient {
    const session = loadSession();
    // CODER_API_URL beats the URL recorded in the session file (tests,
    // proxies, migrations).
    return new ApiClient(resolveServerUrl(), session?.token);
  }

  static at(serverUrl: string, token?: string): ApiClient {
    return new ApiClient(serverUrl, token);
  }

  get baseUrl(): string {
    return this.serverUrl;
  }

  async request<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let res: Response;
    try {
      res = await fetch(`${this.serverUrl}${API_PREFIX}${path}`, {
        method: opts.method ?? "GET",
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
    } catch (err) {
      throw new NetworkError(
        `Cannot reach the CODER backend at ${this.serverUrl} (${(err as Error).message}). ` +
          `Start it with \`coder server start\`.`,
      );
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (res.status === 401 || res.status === 403) {
      const message =
        body && typeof body === "object"
          ? String((body as { error?: { message?: string } }).error?.message ?? "request failed")
          : "request failed";
      if (res.status === 401 && this.token) {
        throw new AuthError(`Session expired or invalid: ${message} — run \`coder login\` again.`);
      }
      throw new AuthError(message);
    }
    if (!res.ok) {
      const message =
        body && typeof body === "object"
          ? String((body as { error?: { message?: string } }).error?.message ?? "request failed")
          : `HTTP ${res.status}`;
      throw new NetworkError(`Backend error (HTTP ${res.status}): ${message}`);
    }
    return { status: res.status, body: body as T };
  }

  get<T>(path: string) {
    return this.request<T>(path);
  }

  post<T>(path: string, body?: unknown) {
    return this.request<T>(path, { method: "POST", body });
  }

  patch<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: "PATCH", body });
  }

  delete<T>(path: string) {
    return this.request<T>(path, { method: "DELETE" });
  }
}
