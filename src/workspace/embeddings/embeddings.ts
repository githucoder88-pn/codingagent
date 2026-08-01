/**
 * CODER — embeddings (Phase 3).
 *
 * Local, dependency-free embedding provider: feature-hashed token n-grams
 * into a fixed-dimension vector (L2-normalized), giving a deterministic
 * bag-of-ngrams representation that supports cosine similarity for
 * semantic search — fully offline. A provider-based embedding hook
 * (OpenAI-compatible APIs) is defined for when network access exists.
 */

import { createHash } from "node:crypto";

export const EMBEDDING_DIM = 256;
export const LOCAL_EMBEDDING_MODEL = "coder-local-hash-v1";

export interface EmbeddingProvider {
  readonly model: string;
  embed(text: string): number[];
  /** Whether this provider is usable right now. */
  available(): boolean;
}

// ------------------------------------------------------------ tokenizer

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  // identifiers (camelCase split), words, numbers
  const matches = text.match(/[A-Za-z_][A-Za-z0-9_]*|\d+/g) ?? [];
  for (const match of matches) {
    tokens.push(match.toLowerCase());
    // split camelCase identifiers into parts for better overlap
    const parts = match.split(/(?=[A-Z])/).map((p) => p.toLowerCase());
    if (parts.length > 1) tokens.push(...parts);
  }
  return tokens;
}

// ------------------------------------------------------ feature hashing

export class LocalHashEmbeddingProvider implements EmbeddingProvider {
  readonly model = LOCAL_EMBEDDING_MODEL;

  constructor(private readonly dim = EMBEDDING_DIM) {}

  available(): boolean {
    return true;
  }

  embed(text: string): number[] {
    const vector = new Array<number>(this.dim).fill(0);
    const tokens = tokenize(text);
    // Unigrams + bigrams.
    const grams: string[] = [...tokens];
    for (let i = 0; i < tokens.length - 1; i += 1) {
      grams.push(`${tokens[i]} ${tokens[i + 1]}`);
    }
    for (const gram of grams) {
      const hash = createHash("sha256").update(gram).digest();
      const index = hash.readUInt32BE(0) % this.dim;
      const sign = hash[4]! % 2 === 0 ? 1 : -1;
      vector[index] = (vector[index] ?? 0) + sign;
    }
    return l2Normalize(vector);
  }
}

// -------------------------------------------------------------- cosine

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function l2Normalize(vector: number[]): number[] {
  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

/** Rank documents by cosine similarity to a query. */
export function rankBySimilarity(queryVector: number[], documents: Array<{ id: string; vector: number[] }>, limit = 10): Array<{ id: string; score: number }> {
  return documents
    .map((doc) => ({ id: doc.id, score: cosineSimilarity(queryVector, doc.vector) }))
    .filter((r) => r.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Optional provider-based embeddings (used when network access exists). */
export class RemoteEmbeddingProvider implements EmbeddingProvider {
  readonly model = "openai-text-embedding-3-small";

  constructor(
    private readonly apiKey: string | undefined,
    private readonly baseUrl = "https://api.openai.com/v1",
  ) {}

  available(): boolean {
    return Boolean(this.apiKey);
  }

  async embedRemote(text: string): Promise<number[] | null> {
    if (!this.available()) return null;
    try {
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: Array<{ embedding: number[] }> };
      return body.data?.[0]?.embedding ?? null;
    } catch {
      return null;
    }
  }

  embed(_text: string): number[] {
    // Synchronous interface is satisfied by the local provider; remote
    // embeddings flow through `embedRemote` + the store's async path.
    return [];
  }
}
