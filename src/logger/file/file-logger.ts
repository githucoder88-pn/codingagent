/**
 * CODER — file logger.
 *
 * Writes pino JSON lines to `~/.coder/logs/`:
 *   - debug.log  — everything (level trace+)
 *   - error.log  — errors only
 *   - latest.log — everything, truncated at the start of each process run
 *                  (the most recent invocation only)
 *
 * Files rotate once they exceed LOG_ROTATE_BYTES (keeps `.1` backups).
 */

import { createWriteStream, existsSync, mkdirSync, truncateSync, WriteStream } from "node:fs";
import { dirname } from "node:path";
import { Writable } from "node:stream";
import { LOG_ROTATE_BYTES } from "../../core/constants/index.js";
import { paths } from "../../utils/paths.js";

export interface FileLoggerOptions {
  /** Max size before rotating the active file (defaults to LOG_ROTATE_BYTES). */
  maxBytes?: number;
}

/** A pino-compatible sink that rotates the target file when it grows too big. */
class RotatingSink extends Writable {
  private stream: WriteStream;
  private bytesWritten = 0;

  constructor(
    private readonly file: string,
    private readonly maxBytes: number,
  ) {
    super();
    try {
      mkdirSync(dirname(file), { recursive: true });
    } catch {
      /* best effort */
    }
    this.stream = createWriteStream(file, { flags: "a" });
    // Never crash the process on log-file problems (read-only FS, deleted
    // dirs in tests, …) — logging is best-effort by design.
    this.stream.on("error", () => {});
    this.bytesWritten = this.stream.bytesWritten;
  }

  override _write(chunk: Buffer | string, _enc: string, cb: (error?: Error | null) => void): void {
    const size = Buffer.byteLength(chunk);
    if (this.bytesWritten + size > this.maxBytes) this.rotate();
    this.bytesWritten += size;
    if (this.stream.write(chunk)) {
      cb();
    } else {
      this.stream.once("drain", () => cb());
    }
  }

  private rotate(): void {
    const backup = `${this.file}.1`;
    this.stream.end();
    try {
      if (existsSync(backup)) truncateSync(backup, 0);
    } catch {
      /* best effort */
    }
    this.stream = createWriteStream(this.file, { flags: "a" });
    this.stream.on("error", () => {});
    this.bytesWritten = 0;
  }
}

export class FileLogger {
  readonly debug: RotatingSink;
  readonly error: RotatingSink;
  readonly latest: RotatingSink;
  /** Sinks as pino destinations (transport streams). */
  readonly streams: Array<{ level: string; stream: Writable }>;

  constructor(opts?: FileLoggerOptions) {
    const maxBytes = opts?.maxBytes ?? LOG_ROTATE_BYTES;
    this.debug = new RotatingSink(paths.logFile("debug.log"), maxBytes);
    this.error = new RotatingSink(paths.logFile("error.log"), maxBytes);
    this.latest = new RotatingSink(paths.logFile("latest.log"), maxBytes);
    // latest.log mirrors the most recent run: truncate at startup.
    try {
      truncateSync(paths.logFile("latest.log"), 0);
    } catch {
      /* file may not exist yet — first write creates it */
    }
    this.streams = [
      { level: "trace", stream: this.debug },
      { level: "error", stream: this.error },
      { level: "trace", stream: this.latest },
    ];
  }

  close(): void {
    for (const sink of [this.debug, this.error, this.latest]) {
      try {
        sink.end();
      } catch {
        /* best effort */
      }
    }
  }
}
