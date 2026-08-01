import { describe, expect, it } from "vitest";
import { LocalHashEmbeddingProvider, cosineSimilarity, rankBySimilarity, EMBEDDING_DIM } from "../../../src/workspace/embeddings/embeddings.js";

describe("local embeddings", () => {
  const provider = new LocalHashEmbeddingProvider();

  it("produces deterministic normalized vectors", () => {
    const a = provider.embed("authentication login token");
    const b = provider.embed("authentication login token");
    expect(a).toEqual(b);
    expect(a).toHaveLength(EMBEDDING_DIM);
    const norm = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("ranks text with shared tokens above unrelated text", () => {
    const query = provider.embed("password hashing");
    const close = provider.embed("hashing passwords");
    const far = provider.embed("render user interface buttons");
    expect(cosineSimilarity(query, close)).toBeGreaterThan(0);
    expect(cosineSimilarity(query, close)).toBeGreaterThan(cosineSimilarity(query, far));
    expect(cosineSimilarity(query, far)).toBe(0);
  });

  it("ranks documents by similarity", () => {
    const query = provider.embed("database schema");
    const docs = [
      { id: "db.ts", vector: provider.embed("database table schema migration") },
      { id: "ui.tsx", vector: provider.embed("button click render component") },
    ];
    const ranked = rankBySimilarity(query, docs, 5);
    expect(ranked[0]?.id).toBe("db.ts");
    expect(ranked[0]!.score).toBeGreaterThan(0.05);
  });

  it("returns zero similarity for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
});
