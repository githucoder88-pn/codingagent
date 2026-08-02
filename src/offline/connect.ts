/**
 * CODER — key management Mode 3: workspace connections (Phase 11).
 *
 * `coder connect workspace <id>|list|remove`. Connections are recorded
 * locally with a `pending` status while the backend is offline; they are
 * validated (GET /api/workspaces) when the backend becomes reachable.
 * Persisted at ~/.coder/connections.json.
 */

import { coderHome } from "../utils/paths.js";
import { join } from "node:path";
import { JsonStore, nowIso } from "../runtime/store.js";

export interface WorkspaceConnection {
  id: string;
  workspaceId: string;
  label: string;
  status: "pending" | "connected" | "failed";
  createdAt: string;
  validatedAt?: string;
  error?: string;
}

export interface ConnectionStoreData {
  connections: WorkspaceConnection[];
}

const FILE = () => join(coderHome(), "connections.json");

export class ConnectionManager {
  private readonly store = new JsonStore<ConnectionStoreData>(FILE(), { connections: [] });

  list(): WorkspaceConnection[] {
    return this.store.read().connections;
  }

  connect(workspaceId: string, label?: string): WorkspaceConnection {
    const conn: WorkspaceConnection = {
      id: workspaceId,
      workspaceId,
      label: label ?? `workspace-${workspaceId}`,
      status: "pending",
      createdAt: nowIso(),
    };
    this.store.update((d) => {
      const existing = d.connections.findIndex((c) => c.workspaceId === workspaceId);
      if (existing >= 0) d.connections[existing] = conn;
      else d.connections.unshift(conn);
    });
    return conn;
  }

  remove(workspaceId: string): boolean {
    let removed = false;
    this.store.update((d) => {
      const before = d.connections.length;
      d.connections = d.connections.filter((c) => c.workspaceId !== workspaceId);
      removed = d.connections.length < before;
    });
    return removed;
  }

  /**
   * Validate pending connections against the backend. `reachable` indicates
   * whether GET /api/workspaces resolves; a known workspace id validates the
   * connection, an unknown one fails it. Offline → stays pending.
   */
  async validate(reachable: () => Promise<boolean>, knownWorkspace?: (id: string) => boolean): Promise<{ validated: number; pending: number }> {
    let validated = 0;
    let pending = 0;
    const online = await reachable();
    this.store.update((d) => {
      for (const c of d.connections) {
        if (c.status !== "pending") continue;
        if (!online) {
          pending += 1;
          continue;
        }
        if (knownWorkspace?.(c.workspaceId) ?? true) {
          c.status = "connected";
          c.validatedAt = nowIso();
          validated += 1;
        } else {
          c.status = "failed";
          c.error = "workspace not found on backend";
          validated += 1;
        }
      }
    });
    return { validated, pending };
  }
}
