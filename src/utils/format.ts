/**
 * CODER — small formatting helpers shared by the UI and loggers.
 */

/** Render a value as a percentage, tolerating missing parts. */
export function pct(part: number | undefined, total: number | undefined): string {
  if (part === undefined || total === undefined || total === 0) return "—";
  return `${Math.round((part / total) * 100)}%`;
}

/** Human-friendly byte size. */
export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = "B";
  for (const u of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = u;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}

/** Rough token estimate (English-centric ~4 chars/token). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Trim a string to `max` chars, appending "…" when truncated. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Render an aligned text table from rows of cells. Column widths derive from
 * the longest cell (min 3). Empty result returns "".
 */
export function renderTable(headers: string[], rows: string[][], opts?: { indent?: string }): string {
  if (rows.length === 0) return "";
  const indent = opts?.indent ?? "";
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const line = (cells: string[]) =>
    indent + cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  const out: string[] = [line(headers)];
  out.push((indent + widths.map((w) => "-".repeat(w)).join("  ")).trimEnd());
  for (const row of rows) out.push(line(row));
  return out.join("\n");
}

/** Parse "1y/0n/true/false" style values from environment variables. */
export function parseBoolEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return undefined;
}
