/**
 * CODER CLI — local records store.
 *
 * A local log of prompts, responses and feedback (~/.coder/records.json)
 * that powers `coder history`, `coder export`, `coder feedback` and the
 * sync engine. Records are written only when history is enabled
 * (privacy setting) and are pushed to the backend when signed in.
 */

import { z } from "zod";
import { randomId } from "../../shared/src/index.js";
import { localRecordSchema } from "../../shared/src/index.js";
import { paths, readJson, writeJson } from "../utils/paths.js";

export type LocalRecord = z.infer<typeof localRecordSchema>;

export interface NewRecordInput {
  sessionId: string;
  provider: string;
  model: string;
  prompt?: string;
  response?: string;
  tokensUsed?: number;
  latencyMs?: number;
  forTraining?: boolean;
}

export function recordsPath(): string {
  return paths.records();
}

export function loadRecords(): LocalRecord[] {
  const raw = readJson<unknown>(recordsPath());
  if (raw === undefined) return [];
  const parsed = z.array(localRecordSchema).safeParse(raw);
  if (!parsed.success) return [];
  return parsed.data;
}

export function saveRecords(records: LocalRecord[]): void {
  writeJson(recordsPath(), records, { mode: 0o600 });
}

/** Append a new record; returns it. */
export function appendRecord(input: NewRecordInput): LocalRecord {
  const now = new Date().toISOString();
  const record: LocalRecord = {
    id: randomId("rec"),
    createdAt: now,
    updatedAt: now,
    sessionId: input.sessionId,
    provider: input.provider,
    model: input.model,
    ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
    ...(input.response !== undefined ? { response: input.response } : {}),
    ...(input.tokensUsed !== undefined ? { tokensUsed: input.tokensUsed } : {}),
    ...(input.latencyMs !== undefined ? { latencyMs: input.latencyMs } : {}),
    ...(input.forTraining ? { forTraining: true } : {}),
  };
  const records = loadRecords();
  records.push(record);
  saveRecords(records);
  return record;
}

/** Patch an existing record by id. */
export function updateRecord(id: string, patch: Partial<LocalRecord>): LocalRecord | undefined {
  const records = loadRecords();
  const index = records.findIndex((r) => r.id === id);
  if (index === -1) return undefined;
  const updated: LocalRecord = {
    ...records[index]!,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  records[index] = updated;
  saveRecords(records);
  return updated;
}

/** The most recent record (used by `coder feedback`). */
export function latestRecord(sessionId?: string): LocalRecord | undefined {
  const records = loadRecords();
  if (sessionId) return records.filter((r) => r.sessionId === sessionId).at(-1);
  return records.at(-1);
}

/** Records that still need to reach the backend. */
export function unsyncedRecords(): LocalRecord[] {
  return loadRecords().filter((r) => !r.syncedAt);
}
