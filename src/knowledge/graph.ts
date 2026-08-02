/**
 * CODER — global knowledge graph (Phase 8).
 *
 * An entity hierarchy: Framework → Repository → Class → Method →
 * Dependency (plus languages, APIs, goals and lessons). Entities are
 * rebuilt from a repository index and persisted at
 * ~/.coder/cache/knowledge/graph.json. Re-observing an entity bumps its
 * weight (reinforcement); search ranks by weight + textual relevance.
 *
 *   coder knowledge graph | stats | search <q>
 */

import { join } from "node:path";
import { coderHome } from "../utils/paths.js";
import { JsonStore, nowIso } from "../runtime/store.js";
import { type RepoIndex } from "../workspace/types.js";

export type KnowledgeKind = "framework" | "repository" | "class" | "method" | "dependency" | "language" | "api" | "goal" | "lesson";

export interface KnowledgeEntity {
  id: string;
  kind: KnowledgeKind;
  name: string;
  parentId?: string;
  meta: Record<string, unknown>;
  weight: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface KnowledgeGraphData {
  entities: Record<string, KnowledgeEntity>;
  rebuiltAt?: string;
}

const FILE = () => join(coderHome(), "cache", "knowledge", "graph.json");

export class KnowledgeGraph {
  private readonly store = new JsonStore<KnowledgeGraphData>(FILE(), { entities: {} });

  read(): KnowledgeGraphData {
    return this.store.read();
  }

  stats(): { entities: number; byKind: Record<string, number>; weight: number; rebuiltAt?: string } {
    const data = this.read();
    const byKind: Record<string, number> = {};
    let weight = 0;
    for (const e of Object.values(data.entities)) {
      byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
      weight += e.weight;
    }
    return { entities: Object.keys(data.entities).length, byKind, weight, rebuiltAt: data.rebuiltAt };
  }

  /** Rebuild the graph from a repository index. Reinforces existing entities. */
  rebuildFromIndex(index: RepoIndex): { added: number; reinforced: number } {
    const repoId = `repository:${index.root}`;
    const ts = nowIso();
    let added = 0;
    let reinforced = 0;
    this.store.update((data) => {
      // repository node
      upsert(data, repoId, "repository", index.root, undefined, { root: index.root, language: index.stats.language }, ts, (e) => {
        reinforced += 1;
        e.weight += 0.5;
      }, () => (added += 1));

      // languages
      const langs = new Set<string>([index.stats.language]);
      for (const f of index.files) langs.add(f.language);
      for (const lang of langs) {
        if (!lang) continue;
        upsert(data, `language:${lang}`, "language", lang, repoId, {}, ts, noop, () => (added += 1));
      }

      // classes + methods
      for (const file of index.files) {
        for (const sym of file.symbols) {
          if (sym.kind === "class" || sym.kind === "interface" || sym.kind === "type" || sym.kind === "enum") {
            upsert(data, `class:${sym.name}`, "class", sym.name, repoId, { file: sym.file, line: sym.line }, ts, (e) => {
              reinforced += 1;
              e.weight += 0.2;
            }, () => (added += 1));
          } else if (sym.kind === "method" || sym.kind === "function") {
            upsert(data, `method:${sym.name}:${sym.file}`, "method", sym.name, repoId, { file: sym.file, line: sym.line }, ts, (e) => {
              reinforced += 1;
              e.weight += 0.1;
            }, () => (added += 1));
          }
        }
        // dependencies
        for (const dep of file.imports) {
          upsert(data, `dependency:${dep}`, "dependency", dep, repoId, { importedBy: file.path }, ts, (e) => {
            reinforced += 1;
            e.weight += 0.1;
          }, () => (added += 1));
        }
      }
      data.rebuiltAt = ts;
    });
    return { added, reinforced };
  }

  /** Record a goal/lesson against the repository node. */
  record(kind: "goal" | "lesson", name: string, repoKey?: string): KnowledgeEntity {
    const ts = nowIso();
    const id = `${kind}:${name}`;
    let created: KnowledgeEntity | undefined;
    this.store.update((data) => {
      upsert(data, id, kind, name, repoKey ? `repository:${repoKey}` : undefined, {}, ts, noop, noop);
      created = data.entities[id];
    });
    return created!;
  }

  /** Ranked search over the graph (weight × textual relevance). */
  search(query: string, limit = 20): KnowledgeEntity[] {
    const q = query.toLowerCase();
    const entities = Object.values(this.read().entities);
    return entities
      .map((e) => {
        const text = `${e.name} ${e.kind}`.toLowerCase();
        const relevance = text.includes(q) ? 1 : q.split(/\s+/).filter((w) => w && text.includes(w)).length / Math.max(1, q.split(/\s+/).length);
        return { e, score: e.weight * (0.5 + relevance) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.e);
  }
}

function noop(): void {
  /* no-op */
}

function upsert(
  data: KnowledgeGraphData,
  id: string,
  kind: KnowledgeKind,
  name: string,
  parentId: string | undefined,
  meta: Record<string, unknown>,
  ts: string,
  onReinforce: (e: KnowledgeEntity) => void,
  onAdd: () => void,
): void {
  const existing = data.entities[id];
  if (existing) {
    existing.lastSeenAt = ts;
    onReinforce(existing);
    return;
  }
  data.entities[id] = { id, kind, name, parentId, meta, weight: 1, firstSeenAt: ts, lastSeenAt: ts };
  onAdd();
}
