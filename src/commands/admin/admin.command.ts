/**
 * CODER — `coder admin` commands.
 *
 * Admin access to the control plane: users, prompts, feedback, audit logs,
 * training stats, usage analytics and key rotation. All calls require a
 * signed-in admin/superadmin account.
 */

import { ApiClient } from "../../account/api-client.js";
import { requireSession } from "../../account/session-store.js";
import { renderTable } from "../../ui/components/primitives.js";
import { truncate } from "../../utils/format.js";
import { UsageError } from "../../core/errors/index.js";
import { promptConfirm } from "../../ui/components/prompt.js";
import type { AppContext } from "../../core/application/application.js";
import type { TrainingStats, UsageStats } from "../../../shared/src/index.js";

function adminClient(): ApiClient {
  requireSession();
  return ApiClient.fromSession();
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export interface AdminListOptions {
  limit: number;
  offset: number;
  json?: boolean;
  search?: string;
  days?: number;
}

export async function adminUsersCommand(ctx: AppContext, opts: AdminListOptions): Promise<number> {
  const { theme } = ctx;
  const result = await adminClient().get<{
    users: Array<Record<string, unknown>>;
    total: number;
  }>(`/admin/users?limit=${opts.limit}&offset=${opts.offset}${opts.search ? `&search=${encodeURIComponent(opts.search)}` : ""}`);
  if (opts.json) {
    printJson(result.body);
    return 0;
  }
  const rows = result.body.users.map((user) => [
    String(user.email),
    String(user.role),
    user.trainingOptIn ? "yes" : "no",
    String(user.promptCount ?? 0),
    String(user.lastActiveAt ?? "—").slice(0, 19).replace("T", " "),
  ]);
  process.stdout.write(`${renderTable(["EMAIL", "ROLE", "TRAINING", "PROMPTS", "LAST ACTIVE"], rows)}\n`);
  process.stdout.write(`${theme.dim}Total users: ${result.body.total}${theme.reset}\n`);
  return 0;
}

export async function adminPromptsCommand(ctx: AppContext, opts: AdminListOptions): Promise<number> {
  const result = await adminClient().get<{ prompts: Array<Record<string, unknown>> }>(
    `/admin/prompts?limit=${opts.limit}&offset=${opts.offset}`,
  );
  if (opts.json) {
    printJson(result.body);
    return 0;
  }
  const rows = result.body.prompts.map((p) => [
    String(p.createdAt).slice(0, 19).replace("T", " "),
    String(p.userEmail),
    String(p.provider),
    String(p.model),
    truncate(String(p.prompt), 50),
    p.forTraining ? "yes" : "no",
  ]);
  process.stdout.write(`${renderTable(["WHEN", "USER", "PROVIDER", "MODEL", "PROMPT", "TRAINING"], rows)}\n`);
  return 0;
}

export async function adminFeedbackCommand(ctx: AppContext, opts: AdminListOptions): Promise<number> {
  const result = await adminClient().get<{ feedback: Array<Record<string, unknown>>; ratingDistribution: Array<{ rating: number; c: number }> }>(
    `/admin/feedback?limit=${opts.limit}&offset=${opts.offset}`,
  );
  if (opts.json) {
    printJson(result.body);
    return 0;
  }
  const rows = result.body.feedback.map((f) => [
    String(f.createdAt).slice(0, 19).replace("T", " "),
    String(f.userEmail),
    `${String(f.rating)}/5`,
    truncate(String(f.comment ?? "—"), 50),
  ]);
  process.stdout.write(`${renderTable(["WHEN", "USER", "RATING", "COMMENT"], rows)}\n`);
  const dist = result.body.ratingDistribution.map((d) => `${d.rating}: ${d.c}`).join("  ");
  process.stdout.write(`${ctx.theme.dim}Distribution: ${dist}${ctx.theme.reset}\n`);
  return 0;
}

export async function adminLogsCommand(ctx: AppContext, opts: AdminListOptions): Promise<number> {
  const result = await adminClient().get<{ logs: Array<Record<string, unknown>> }>(
    `/admin/logs?limit=${opts.limit}&offset=${opts.offset}${opts.search ? `&action=${encodeURIComponent(opts.search)}` : ""}`,
  );
  if (opts.json) {
    printJson(result.body);
    return 0;
  }
  const rows = result.body.logs.map((log) => [
    String(log.createdAt).slice(0, 19).replace("T", " "),
    String(log.action),
    String(log.actorId ?? "system"),
    String(log.targetType ?? ""),
  ]);
  process.stdout.write(`${renderTable(["WHEN", "ACTION", "ACTOR", "TARGET"], rows)}\n`);
  return 0;
}

export async function adminTrainingCommand(ctx: AppContext, opts: AdminListOptions): Promise<number> {
  const client = adminClient();
  const stats = (await client.get<TrainingStats>("/admin/training")).body;
  const dataset = opts.json
    ? (await client.get<{ rows: unknown[] }>(`/admin/training/dataset?limit=${opts.limit}&offset=${opts.offset}`)).body.rows
    : [];
  if (opts.json) {
    printJson({ stats, dataset });
    return 0;
  }
  process.stdout.write(
    `Training opt-ins: ${stats.optInCount}/${stats.totalUsers} users · dataset: ${stats.datasetPromptCount} prompts\n` +
      `${ctx.theme.dim}Training data is only collected from users who explicitly opted in.${ctx.theme.reset}\n`,
  );
  return 0;
}

export async function adminUsageCommand(ctx: AppContext, opts: AdminListOptions): Promise<number> {
  const { theme } = ctx;
  const days = opts.days ?? 14;
  const result = await adminClient().get<{ usage: UsageStats }>(`/admin/usage?days=${days}`);
  const usage = result.body.usage;
  if (opts.json) {
    printJson(result.body);
    return 0;
  }
  const bar = (count: number, max: number): string => {
    const width = 24;
    const filled = max > 0 ? Math.round((count / max) * width) : 0;
    return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
  };
  const maxDay = Math.max(1, ...usage.promptsPerDay.map((d) => d.count));
  const lines = [
    `${theme.bold}Usage (last ${days} days)${theme.reset}`,
    ...usage.promptsPerDay.map((d) => `  ${d.day}  ${bar(d.count, maxDay)} ${d.count}`),
    "",
    `Prompts by provider: ${usage.byProvider.map((p) => `${p.provider}=${p.count}`).join(", ") || "—"}`,
    `Top models: ${usage.byModel.map((m) => `${m.model} (${m.count})`).slice(0, 5).join(", ") || "—"}`,
    `Avg latency: ${usage.avgLatencyMs ?? "—"} ms · tokens: ${usage.totalTokens}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

export async function adminModelsCommand(ctx: AppContext, opts: AdminListOptions): Promise<number> {
  const { theme } = ctx;
  const result = await adminClient().get<{ models: Array<Record<string, unknown>> }>(
    `/admin/models?limit=${opts.limit}&offset=${opts.offset}${opts.search ? `&search=${encodeURIComponent(opts.search)}` : ""}`,
  );
  if (opts.json) {
    printJson(result.body);
    return 0;
  }
  const rows = result.body.models.map((m) => [
    String(m.provider),
    String(m.model),
    String(m.usageCount),
    String(m.lastSeenAt).slice(0, 19).replace("T", " "),
  ]);
  if (rows.length === 0) {
    process.stdout.write(`${theme.dim}No model metadata yet (no prompts recorded).${theme.reset}\n`);
    return 0;
  }
  process.stdout.write(`${renderTable(["PROVIDER", "MODEL", "USES", "LAST SEEN"], rows)}\n`);
  return 0;
}

export async function adminRotateKeyCommand(ctx: AppContext, opts: { yes?: boolean }): Promise<number> {
  const { theme } = ctx;
  if (!opts.yes) {
    const confirmed = await promptConfirm(
      "Rotate the master encryption key? All stored provider keys will be re-encrypted. Continue?",
      false,
    );
    if (confirmed !== true) {
      process.stdout.write(`${theme.dim}Aborted.${theme.reset}\n`);
      return 0;
    }
  }
  const result = await adminClient().post<{ reencrypted: number; activeVersion: string }>("/admin/rotate-key");
  process.stdout.write(
    `${theme.success}Master key rotated (version ${result.body.activeVersion}); ${result.body.reencrypted} provider keys re-encrypted.${theme.reset}\n`,
  );
  return 0;
}
