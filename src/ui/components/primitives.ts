/**
 * CODER — UI primitives.
 *
 * Dependency-free rendering helpers: banner boxes, spinners, tables and
 * coloured output. Everything here writes plain strings so it is trivially
 * testable and works on any terminal.
 */

import { type Theme } from "../themes/theme.js";

// ------------------------------------------------------------------ banner

export interface BannerRow {
  label: string;
  value: string;
}

/** Render the rounded-corner CODER banner shown at chat startup. */
export function renderBanner(
  title: string,
  rows: BannerRow[],
  theme: Theme,
  opts?: { divider?: boolean },
): string {
  const content: Array<{ label: string; value: string }> = [
    { label: "", value: title },
    ...rows,
  ];
  // Inner width: label + " : " + value (title has no label prefix).
  const innerWidth = Math.max(...content.map((r) => r.label.length + (r.label ? 3 : 0) + r.value.length));
  const top = `${theme.accent}╭${"─".repeat(innerWidth + 2)}╮${theme.reset}`;
  const bottom = `${theme.accent}╰${"─".repeat(innerWidth + 2)}╯${theme.reset}`;
  const divider = `${theme.accent}├${"─".repeat(innerWidth + 2)}┤${theme.reset}`;
  const lines: string[] = [top];
  content.forEach((r, i) => {
    if (i === 1 && opts?.divider) lines.push(divider);
    const text = r.label ? `${r.label} : ${r.value}` : r.value;
    const pad = " ".repeat(innerWidth - text.length);
    lines.push(`${theme.accent}│${theme.reset} ${theme.dim}${r.label}${theme.reset}${r.label ? " : " : ""}${theme.bold}${r.value}${theme.reset}${pad} ${theme.accent}│${theme.reset}`);
  });
  lines.push(bottom);
  return lines.join("\n");
}

// ----------------------------------------------------------------- spinner

export class Spinner {
  private timer: NodeJS.Timeout | null = null;
  private frame = 0;
  private text = "";
  private stopped = false;

  private static readonly FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  constructor(
    private readonly stream: NodeJS.WriteStream = process.stdout,
    private readonly tty = stream.isTTY === true,
  ) {}

  start(text: string): void {
    this.stopped = false;
    this.text = text;
    if (!this.tty) {
      this.stream.write(`${text}\n`);
      return;
    }
    this.timer = setInterval(() => {
      const frame = Spinner.FRAMES[this.frame % Spinner.FRAMES.length] ?? " ";
      this.stream.write(`\r${frame} ${this.text}\u001b[K`);
      this.frame += 1;
    }, 80);
  }

  update(text: string): void {
    this.text = text;
    if (!this.tty) return;
    const frame = Spinner.FRAMES[this.frame % Spinner.FRAMES.length] ?? " ";
    this.stream.write(`\r${frame} ${this.text}\u001b[K`);
    this.frame += 1;
  }

  stop(final?: string): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.stream.write(`\r\u001b[K`);
      if (final) this.stream.write(`${final}\n`);
    } else if (final) {
      this.stream.write(`${final}\n`);
    }
  }

  get running(): boolean {
    return !this.stopped;
  }
}

// ------------------------------------------------------------------ table

export { renderTable } from "../../utils/format.js";

// ----------------------------------------------------------------- output

export function success(text: string, theme: Theme): string {
  return `${theme.success}✓ ${text}${theme.reset}`;
}

export function error(text: string, theme: Theme): string {
  return `${theme.error}✗ ${text}${theme.reset}`;
}

export function warn(text: string, theme: Theme): string {
  return `${theme.warning}⚠ ${text}${theme.reset}`;
}

export function dim(text: string, theme: Theme): string {
  return `${theme.dim}${text}${theme.reset}`;
}

export function header(text: string, theme: Theme): string {
  return `${theme.bold}${theme.accent}${text}${theme.reset}`;
}
