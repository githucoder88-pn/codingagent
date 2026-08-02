/**
 * CODER — extension manager (Phase 4).
 *
 * Extensions are local packages that contribute tools, commands or
 * providers. Each has an `extension.json` manifest; the registry lives at
 * ~/.coder/extensions/extensions.json and installed payloads under
 * ~/.coder/extensions/<id>/. Install/update are file operations so they
 * work fully offline.
 */

import { join } from "node:path";
import { coderHome } from "../utils/paths.js";
import { JsonStore, nowIso, shortId } from "../runtime/store.js";

export interface ExtensionManifest {
  name: string;
  version: string;
  description?: string;
  entry?: string;
  tools?: string[];
  commands?: string[];
}

export interface Extension {
  id: string;
  manifest: ExtensionManifest;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
  source: string;
}

export interface ExtensionRegistryData {
  extensions: Record<string, Extension>;
}

const DIR = () => join(coderHome(), "extensions");
const FILE = () => join(DIR(), "extensions.json");

export class ExtensionManager {
  private readonly store = new JsonStore<ExtensionRegistryData>(FILE(), { extensions: {} });

  list(): Extension[] {
    return Object.values(this.store.read().extensions).sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  }

  get(id: string): Extension | undefined {
    return this.store.read().extensions[id];
  }

  install(manifest: ExtensionManifest, source = "local"): Extension {
    const existing = this.findByName(manifest.name);
    const id = existing?.id ?? shortId("ext-");
    const ts = nowIso();
    const ext: Extension = {
      id,
      manifest,
      enabled: true,
      installedAt: existing?.installedAt ?? ts,
      updatedAt: ts,
      source,
    };
    this.store.update((data) => (data.extensions[id] = ext));
    return ext;
  }

  update(id: string, manifest: Partial<ExtensionManifest>): Extension | undefined {
    let updated: Extension | undefined;
    this.store.update((data) => {
      const ext = data.extensions[id];
      if (!ext) return;
      ext.manifest = { ...ext.manifest, ...manifest };
      ext.updatedAt = nowIso();
      updated = ext;
    });
    return updated;
  }

  remove(id: string): boolean {
    let removed = false;
    this.store.update((data) => {
      if (data.extensions[id]) {
        delete data.extensions[id];
        removed = true;
      }
    });
    return removed;
  }

  setEnabled(id: string, enabled: boolean): Extension | undefined {
    let updated: Extension | undefined;
    this.store.update((data) => {
      const ext = data.extensions[id];
      if (ext) {
        ext.enabled = enabled;
        updated = ext;
      }
    });
    return updated;
  }

  /** Validate a manifest shape (used by install + tests). */
  static validate(manifest: unknown): manifest is ExtensionManifest {
    return (
      !!manifest &&
      typeof manifest === "object" &&
      typeof (manifest as ExtensionManifest).name === "string" &&
      typeof (manifest as ExtensionManifest).version === "string"
    );
  }

  private findByName(name: string): Extension | undefined {
    return this.list().find((e) => e.manifest.name === name);
  }
}

export { DIR as extensionsDir };
