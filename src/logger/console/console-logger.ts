/**
 * CODER — console logger.
 *
 * Human-friendly console output (no raw JSON) with level-aware colours.
 * Colours are disabled automatically when stdout is not a TTY or when
 * NO_COLOR is set (see src/ui/themes).
 */

import { stdout } from "node:process";
import { isTty } from "../../utils/tty.js";
import { type Theme } from "../../ui/themes/theme.js";

export type ConsoleLevel = "debug" | "info" | "warn" | "error";

const PREFIX: Record<ConsoleLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

export interface ConsoleLoggerOptions {
  theme?: Theme;
  /** Show debug lines on the console (CODER_DEBUG=1). */
  debug?: boolean;
  /** Write to stderr instead of stdout. */
  stderr?: boolean;
}

export class ConsoleLogger {
  constructor(private readonly opts: ConsoleLoggerOptions = {}) {}

  /** Whether debug lines are enabled (used by Logger.child). */
  debugEnabled(): boolean {
    return this.opts.debug ?? false;
  }

  /** The theme in use (used by Logger.child). */
  themeForChild(): Theme | undefined {
    return this.opts.theme;
  }

  private theme(): Theme {
    return this.opts.theme ?? { accent: "", dim: "", muted: "", success: "", error: "", warning: "", bold: "", reset: "" };
  }

  private enabled(): boolean {
    return this.opts.debug ?? false;
  }

  log(level: ConsoleLevel, message: string): void {
    // Console stays clean by default: only warnings and errors are shown
    // unless debug output is enabled (--debug / CODER_DEBUG=1).
    if ((level === "debug" || level === "info") && !this.enabled()) return;
    const theme = this.theme();
    const color = level === "error" ? theme.error : level === "warn" ? theme.warning : level === "debug" ? theme.dim : theme.accent;
    const stream = level === "error" || this.opts.stderr ? process.stderr : stdout;
    stream.write(`${color}${PREFIX[level]}${theme.reset} ${message}\n`);
  }

  debug(message: string): void {
    this.log("debug", message);
  }

  info(message: string): void {
    this.log("info", message);
  }

  warn(message: string): void {
    this.log("warn", message);
  }

  error(message: string): void {
    this.log("error", message);
  }
}

/** True when debug output should be shown on the console. */
export function debugEnabled(): boolean {
  const env = process.env.CODER_DEBUG;
  if (env === undefined) return false;
  return !["0", "false", "no", "off"].includes(env.trim().toLowerCase());
}

/** True when stdout is a real terminal (used to pick UI modes). */
export function isInteractive(): boolean {
  return isTty(stdout);
}
