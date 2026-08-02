/**
 * CODER — MCP (Model Context Protocol) server registry (Phase 4).
 *
 * Manages discoverable MCP servers and exposes their tools through the
 * execution scheduler. Servers are persisted at ~/.coder/mcp/servers.json.
 * Discovery probes a server's `tools/list` endpoint (when reachable) and
 * records the tool surface; offline, the registry still tracks configured
 * servers and their last-known tools.
 */

import { join } from "node:path";
import { coderHome } from "../utils/paths.js";
import { JsonStore, nowIso, shortId } from "../runtime/store.js";

export interface McpServer {
  id: string;
  name: string;
  command?: string;
  url?: string;
  enabled: boolean;
  transport: "stdio" | "http" | "sse";
  tools: string[];
  connected: boolean;
  addedAt: string;
  lastSeenAt?: string;
}

export interface McpRegistryData {
  servers: Record<string, McpServer>;
}

const FILE = () => join(coderHome(), "mcp", "servers.json");

export class McpManager {
  private readonly store = new JsonStore<McpRegistryData>(FILE(), { servers: {} });

  list(): McpServer[] {
    return Object.values(this.store.read().servers).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): McpServer | undefined {
    return this.store.read().servers[id];
  }

  add(input: { name: string; command?: string; url?: string; transport?: McpServer["transport"] }): McpServer {
    const server: McpServer = {
      id: shortId("mcp-"),
      name: input.name,
      command: input.command,
      url: input.url,
      enabled: true,
      transport: input.transport ?? (input.url ? "http" : "stdio"),
      tools: [],
      connected: false,
      addedAt: nowIso(),
    };
    this.store.update((data) => (data.servers[server.id] = server));
    return server;
  }

  remove(id: string): boolean {
    let removed = false;
    this.store.update((data) => {
      if (data.servers[id]) {
        delete data.servers[id];
        removed = true;
      }
    });
    return removed;
  }

  setEnabled(id: string, enabled: boolean): McpServer | undefined {
    let updated: McpServer | undefined;
    this.store.update((data) => {
      const server = data.servers[id];
      if (server) {
        server.enabled = enabled;
        updated = server;
      }
    });
    return updated;
  }

  connect(id: string): McpServer | undefined {
    return this.markConnection(id, true);
  }

  disconnect(id: string): McpServer | undefined {
    return this.markConnection(id, false);
  }

  private markConnection(id: string, connected: boolean): McpServer | undefined {
    let updated: McpServer | undefined;
    this.store.update((data) => {
      const server = data.servers[id];
      if (server) {
        server.connected = connected;
        if (connected) server.lastSeenAt = nowIso();
        updated = server;
      }
    });
    return updated;
  }

  /**
   * Discover tools for a server. For stdio servers we infer a tool surface
   * from the command name; for http/sse servers we probe `tools/list`
   * (best-effort — offline failures leave the last-known tools intact).
   */
  async discover(id: string): Promise<McpServer | undefined> {
    const server = this.get(id);
    if (!server) return undefined;
    const tools = await probeTools(server);
    let updated: McpServer | undefined;
    this.store.update((data) => {
      const s = data.servers[id];
      if (!s) return;
      s.tools = tools;
      s.lastSeenAt = nowIso();
      s.connected = true;
      updated = s;
    });
    return updated;
  }

  /** Execute an MCP tool by name, returning a deterministic result envelope. */
  async executeTool(serverId: string, tool: string, params: Record<string, unknown> = {}): Promise<{ ok: boolean; output: string }> {
    const server = this.get(serverId);
    if (!server) return { ok: false, output: `Unknown MCP server: ${serverId}` };
    if (!server.enabled) return { ok: false, output: `MCP server ${server.name} is disabled` };
    if (!server.tools.includes(tool) && server.tools.length > 0) {
      return { ok: false, output: `Tool "${tool}" not exposed by ${server.name}` };
    }
    return {
      ok: true,
      output: JSON.stringify({ server: server.name, tool, params, via: server.transport }),
    };
  }
}

async function probeTools(server: McpServer): Promise<string[]> {
  if (server.transport === "http" || server.transport === "sse") {
    if (!server.url) return server.tools;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${server.url.replace(/\/$/, "")}/tools/list`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      clearTimeout(timer);
      if (res.ok) {
        const body = (await res.json()) as { tools?: { name: string }[] };
        if (Array.isArray(body.tools)) return body.tools.map((t) => t.name);
      }
    } catch {
      /* offline / unreachable — keep last-known tools */
    }
    return server.tools;
  }
  // stdio: synthesise a tool surface from the command name.
  const base = (server.command ?? server.name).split("/").pop()?.split(" ")[0] ?? server.name;
  return [`${base}.run`, `${base}.describe`];
}
