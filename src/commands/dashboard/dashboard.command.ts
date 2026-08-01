/**
 * CODER — `coder dashboard`.
 *
 * Opens the web dashboard: starts the backend if it is not running, then
 * opens the browser (or prints the URL when headless).
 */

import { spawn } from "node:child_process";
import { API_DEFAULT_PORT } from "../../../shared/src/index.js";
import { serverStartCommand, serverStatus } from "../server/server.command.js";
import type { AppContext } from "../../core/application/application.js";

export interface DashboardOptions {
  port?: number;
  noOpen?: boolean;
}

function openBrowser(url: string): void {
  const platform = process.platform;
  let command: string;
  let args: string[];
  if (platform === "darwin") {
    command = "open";
    args = [url];
  } else if (platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    /* headless environment — the URL is printed instead */
  }
}

export async function dashboardCommand(ctx: AppContext, opts: DashboardOptions = {}): Promise<number> {
  const { theme } = ctx;
  const port = opts.port ?? Number(process.env.CODER_API_PORT ?? API_DEFAULT_PORT);
  const url = `http://127.0.0.1:${port}`;

  const health = await serverStatus(ctx, port);
  if (!health.ok) {
    await serverStartCommand(ctx, { port });
  }

  const finalHealth = await serverStatus(ctx, port);
  if (!finalHealth.ok) {
    throw new Error(`Dashboard backend is not running on ${url}. Check \`coder server status\`.`);
  }

  process.stdout.write(`${theme.bold}CODER Dashboard${theme.reset}: ${url}\n`);
  if (opts.noOpen || !process.stdout.isTTY) {
    process.stdout.write(`${theme.dim}(not opening a browser — headless)${theme.reset}\n`);
    return 0;
  }
  openBrowser(url);
  return 0;
}
