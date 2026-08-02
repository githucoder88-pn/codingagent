/**
 * Phase 6 unit tests: organizations + cloud workspaces + cluster.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OrganizationManager } from "../../../src/organizations/manager.js";
import { ClusterManager } from "../../../src/runtime/cluster.js";

let home = "";
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "coder-ent-"));
  process.env.CODER_HOME = home;
});
afterEach(() => {
  delete process.env.CODER_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("organizations", () => {
  it("creates an org with an owner member", () => {
    const mgr = new OrganizationManager();
    const org = mgr.createOrg({ name: "Acme", ownerId: "u1", email: "a@x" });
    expect(org.members).toHaveLength(1);
    expect(org.members[0]!.role).toBe("owner");
    expect(mgr.getOrg("Acme")!.id).toBe(org.id);
  });
  it("adds and removes members", () => {
    const mgr = new OrganizationManager();
    const org = mgr.createOrg({ name: "Acme", ownerId: "u1", email: "a@x" });
    mgr.addMember(org.id, { userId: "u2", email: "b@x", role: "admin" });
    expect(mgr.getOrg(org.id)!.members).toHaveLength(2);
    mgr.removeMember(org.id, "u2");
    expect(mgr.getOrg(org.id)!.members).toHaveLength(1);
  });
  it("stores shared memory scoped to the org", () => {
    const mgr = new OrganizationManager();
    const org = mgr.createOrg({ name: "Acme", ownerId: "u1", email: "a@x" });
    mgr.storeSharedMemory(org.id, { scope: "global", key: "style", value: "tabs" });
    expect(mgr.getOrg(org.id)!.sharedMemory).toHaveLength(1);
  });
});

describe("cloud workspaces", () => {
  it("creates workspaces with environment-aware initial status", () => {
    const mgr = new OrganizationManager();
    const local = mgr.createWorkspace({ name: "dev", ownerId: "u1", environment: "local" });
    expect(local.status).toBe("running"); // local comes up immediately
    const cloud = mgr.createWorkspace({ name: "prod", ownerId: "u1", environment: "dedicated-cloud" });
    expect(cloud.status).toBe("creating");
  });
  it("transitions through start/stop/destroy", () => {
    const mgr = new OrganizationManager();
    const ws = mgr.createWorkspace({ name: "dev", ownerId: "u1", environment: "container" });
    mgr.setWorkspaceStatus(ws.id, "stopped");
    expect(mgr.getWorkspace(ws.id)!.status).toBe("stopped");
    mgr.destroyWorkspace(ws.id);
    expect(mgr.getWorkspace(ws.id)!.status).toBe("destroyed");
  });
});

describe("cluster", () => {
  it("registers workers and runs a queued task once", async () => {
    const cluster = new ClusterManager();
    cluster.bringControllerOnline();
    const node = cluster.registerWorker({ name: "n1", type: "agent", region: "us" });
    expect(cluster.listWorkers()).toHaveLength(1);
    const ran = await cluster.runOnce(node.id);
    expect(ran.ran).toBe(false); // no tasks queued
    expect(cluster.summary().controllerOnline).toBe(true);
  });
});
