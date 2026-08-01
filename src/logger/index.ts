/**
 * CODER — application logger.
 *
 * Combines the pino JSON logger (file sinks) with the human console logger.
 * Resolved from the container as the single `logger` service.
 */

import { pino, multistream, type Logger as PinoLogger } from "pino";
import { ConsoleLogger } from "./console/console-logger.js";
import { FileLogger } from "./file/file-logger.js";
import { type Theme } from "../ui/themes/theme.js";

export interface LoggerOptions {
  level?: "trace" | "debug" | "info" | "warn" | "error";
  consoleDebug?: boolean;
  theme?: Theme;
}

export class Logger {
  pino: PinoLogger;
  readonly console: ConsoleLogger;
  readonly file: FileLogger;

  constructor(opts: LoggerOptions = {}) {
    this.file = new FileLogger();
    this.pino = pino(
      {
        level: opts.level ?? "info",
        base: { app: "coder", version: "0.1.0" },
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      multistream(this.file.streams),
    );
    this.console = new ConsoleLogger({
      debug: opts.consoleDebug ?? false,
      theme: opts.theme,
    });
  }

  debug(msg: string, ...args: unknown[]): void {
    this.pino.debug(args.length ? { args } : undefined, msg);
    this.console.debug(msg);
  }

  info(msg: string, ...args: unknown[]): void {
    this.pino.info(args.length ? { args } : undefined, msg);
    this.console.info(msg);
  }

  warn(msg: string, ...args: unknown[]): void {
    this.pino.warn(args.length ? { args } : undefined, msg);
    this.console.warn(msg);
  }

  error(msg: string, ...args: unknown[]): void {
    this.pino.error(args.length ? { args } : undefined, msg);
    this.console.error(msg);
  }

  child(bindings: Record<string, unknown>): Logger {
    const child = new Logger({
      consoleDebug: this.console.debugEnabled(),
      theme: this.console.themeForChild(),
    });
    child.pino = this.pino.child(bindings);
    return child;
  }

  close(): void {
    try {
      this.file.close();
    } catch {
      /* best effort */
    }
  }
}
