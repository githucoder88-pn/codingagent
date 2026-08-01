/**
 * CODER backend — entry point.
 *
 * Started by `coder server start` (or directly: node dist/server.js).
 * Binds 127.0.0.1:8747 by default; override with CODER_API_HOST/PORT.
 */

import { realpathSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { API_PREFIX } from "../../shared/src/index.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { app, db, close } = await createServer(config);

  const server = app.listen(config.port, config.host, () => {
    const line = `[coder-server] listening on http://${config.host}:${config.port} (dashboard at /)\n`;
    process.stdout.write(line);
    try {
      appendFileSync(config.logFile, line);
    } catch {
      /* best effort */
    }
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    process.stderr.write(`[coder-server] failed to listen on ${config.host}:${config.port}: ${err.message}\n`);
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`[coder-server] ${signal} — shutting down\n`);
    server.close(() => {
      void close().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

if (process.argv[1]) {
  let entry = process.argv[1];
  try {
    entry = realpathSync(entry);
  } catch {
    /* keep argv path */
  }
  if (import.meta.url === pathToFileURL(entry).href) {
    void main();
  }
}

export { createServer, loadConfig, API_PREFIX };
