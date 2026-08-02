/**
 * CODER — organizations & cloud workspaces (Phase 6).
 *
 * Multi-tenant grouping with role-bearing members, shared memory and cloud
 * workspaces. The backend mirrors these as SQLite tables; the CLI keeps a
 * local, offline-first copy at ~/.coder/organizations/orgs.json so every
 * command works without a network.
 */

import { join } from "node:path";
import { coderHome } from "../utils/paths.js";
import { JsonStore, nowIso, shortId } from "../runtime/store.js";

export type OrgRole = "owner" | "admin" | "member";
export type WorkspaceEnv = "local" | "hybrid" | "dedicated-cloud" | "kubernetes" | "container" | "serverless";
export type WorkspaceStatus = "creating" | "running" | "stopped" | "destroyed";

export interface OrgMember {
  userId: string;
  email: string;
  role: OrgRole;
  addedAt: string;
}

export interface Organization {
  id: string;
  name: string;
  ownerId: string;
  plan: "team" | "business" | "enterprise";
  members: OrgMember[];
  sharedMemory: Array<{ id: string; scope: string; key: string; value: string; at: string }>;
  createdAt: string;
}

export interface CloudWorkspace {
  id: string;
  orgId: string | null;
  ownerId: string;
  name: string;
  environment: WorkspaceEnv;
  status: WorkspaceStatus;
  region: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrgStoreData {
  orgs: Record<string, Organization>;
  workspaces: Record<string, CloudWorkspace>;
}

const FILE = () => join(coderHome(), "organizations", "orgs.json");

export class OrganizationManager {
  private readonly store = new JsonStore<OrgStoreData>(FILE(), { orgs: {}, workspaces: {} });

  listOrgs(): Organization[] {
    return Object.values(this.store.read().orgs).sort((a, b) => a.name.localeCompare(b.name));
  }

  getOrg(idOrName: string): Organization | undefined {
    const data = this.store.read();
    return data.orgs[idOrName] ?? this.listOrgs().find((o) => o.name === idOrName);
  }

  createOrg(input: { name: string; ownerId: string; email: string; plan?: Organization["plan"] }): Organization {
    const org: Organization = {
      id: shortId("org-"),
      name: input.name,
      ownerId: input.ownerId,
      plan: input.plan ?? "team",
      members: [{ userId: input.ownerId, email: input.email, role: "owner", addedAt: nowIso() }],
      sharedMemory: [],
      createdAt: nowIso(),
    };
    this.store.update((data) => (data.orgs[org.id] = org));
    return org;
  }

  addMember(idOrName: string, member: { userId: string; email: string; role?: OrgRole }): Organization | undefined {
    let updated: Organization | undefined;
    this.store.update((data) => {
      const org = data.orgs[idOrName] ?? Object.values(data.orgs).find((o) => o.name === idOrName);
      if (!org) return;
      if (!org.members.some((m) => m.userId === member.userId)) {
        org.members.push({ userId: member.userId, email: member.email, role: member.role ?? "member", addedAt: nowIso() });
      }
      updated = org;
    });
    return updated;
  }

  removeMember(idOrName: string, userId: string): Organization | undefined {
    let updated: Organization | undefined;
    this.store.update((data) => {
      const org = data.orgs[idOrName] ?? Object.values(data.orgs).find((o) => o.name === idOrName);
      if (!org) return;
      org.members = org.members.filter((m) => m.userId !== userId);
      updated = org;
    });
    return updated;
  }

  storeSharedMemory(idOrName: string, entry: { scope: string; key: string; value: string }): Organization | undefined {
    let updated: Organization | undefined;
    this.store.update((data) => {
      const org = data.orgs[idOrName] ?? Object.values(data.orgs).find((o) => o.name === idOrName);
      if (!org) return;
      org.sharedMemory.unshift({ id: shortId("mem-"), scope: entry.scope, key: entry.key, value: entry.value, at: nowIso() });
      updated = org;
    });
    return updated;
  }

  // ---- workspaces -----------------------------------------------------

  listWorkspaces(): CloudWorkspace[] {
    return Object.values(this.store.read().workspaces).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  createWorkspace(input: { name: string; orgId?: string; ownerId: string; environment?: WorkspaceEnv; region?: string }): CloudWorkspace {
    const ws: CloudWorkspace = {
      id: shortId("ws-"),
      orgId: input.orgId ?? null,
      ownerId: input.ownerId,
      name: input.name,
      environment: input.environment ?? "local",
      status: "creating",
      region: input.region ?? "default",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.update((data) => (data.workspaces[ws.id] = ws));
    // local/container workspaces come up immediately; cloud envs stay creating.
    if (ws.environment === "local" || ws.environment === "container") {
      this.setWorkspaceStatus(ws.id, "running");
    }
    return this.getWorkspace(ws.id)!;
  }

  getWorkspace(id: string): CloudWorkspace | undefined {
    return this.store.read().workspaces[id];
  }

  setWorkspaceStatus(id: string, status: WorkspaceStatus): CloudWorkspace | undefined {
    let updated: CloudWorkspace | undefined;
    this.store.update((data) => {
      const ws = data.workspaces[id];
      if (!ws) return;
      ws.status = status;
      ws.updatedAt = nowIso();
      updated = ws;
    });
    return updated;
  }

  destroyWorkspace(id: string): CloudWorkspace | undefined {
    return this.setWorkspaceStatus(id, "destroyed");
  }
}
