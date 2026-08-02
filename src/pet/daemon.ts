/**
 * CODER — persistent pet daemon (Phase 11).
 *
 * `coder daemon start [--dir] [--autonomous]` spawns a detached `coder pet`
 * process, recording its pid and workspace at ~/.coder/cache/daemon.json and
 * appending to ~/.coder/logs/daemon.log. `status` reports pid/workspace/log
 * tail; `stop` sends SIGTERM, waits, then SIGKILL as a fallback.
 *
 * The pet itself runs a recovery pass + background sync and then idles with
 * an "Awaiting instructions." message (see commands/pet).
 */

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { coderHome } from "../utils/paths.js";
import { JsonStore, nowIso } from "../runtime/store.js";

export interface DaemonState {
  pid?: number;
  workspace?: string;
  autonomous: boolean;
  startedAt?: string;
  logFile: string;
}

const STATE_FILE = () => join(coderHome(), "cache", "daemon.json");
const LOG_FILE = () => join(coderHome(), "logs", "daemon.log");

export class DaemonManager {
  readonly state = new JsonStore<DaemonState>(STATE_FILE(), { autonomous: false, logFile: LOG_FILE() });

  isRunning(): boolean {
    const s = this.state.read();
    if (!s.pid) return false;
    try {
      process.kill(s.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  status(): DaemonState & { running: boolean } {
    const s = this.state.read();
    return { ...s, running: this.isRunning() };
  }

  logTail(lines = 10): string {
    if (!existsSync(LOG_FILE())) return "";
    const content = readFileSync(LOG_FILE(), "utf8");
    return content.split("\n").filter(Boolean).slice(-lines).join("\n");
  }

  appendLog(message: string): void {
    const dir = join(coderHome(), "logs");
    mkdirSync(dir, { recursive: true });
    appendFileSync(LOG_FILE(), `[${new Date().toISOString()}] ${message}\n`);
  }

  /**
   * Start the daemon. Spawns a detached `coder pet` (resolved from the
   * current node + CLI path). Returns the new state; records a stub when the
   * spawn is not possible (e.g. no built CLI in a unit test).
   */
  start(opts: { workspace?: string; autonomous?: boolean; cliPath?: string }): DaemonState {
    if (this.isRunning()) {
      const existing = this.state.read();
      this.appendLog(`start requested but daemon already running (pid ${existing.pid})`);
      return existing;
    }
    const cliPath = opts.cliPath ?? defaultCliPath();
    let pid: number | undefined;
    if (cliPath && existsSync(cliPath)) {
      const args = ["pet"];
      if (opts.autonomous) args.push("--autonomous");
      if (opts.workspace) args.push("--dir", opts.workspace);
      try {
        const child = spawn(process.execPath, [cliPath, ...args], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
        pid = child.pid;
        this.appendLog(`started detached pet (pid ${pid})`);
      } catch (err) {
        this.appendLog(`failed to spawn pet: ${(err as Error).message}`);
      }
    } else {
      this.appendLog(`start: CLI not found at ${cliPath ?? "(unknown)"}, recording stub state`);
    }
    const next: DaemonState = {
      pid,
      workspace: opts.workspace,
      autonomous: opts.autonomous ?? false,
      startedAt: nowIso(),
      logFile: LOG_FILE(),
    };
    this.state.write(next);
    return next;
  }

  /** SIGTERM, wait up to `timeoutMs`, then SIGKILL. */
  async stop(timeoutMs = 3000): Promise<{ stopped: boolean; forced: boolean }> {
    const s = this.state.read();
    if (!s.pid) {
      this.state.write({ autonomous: false, logFile: LOG_FILE() });
      return { stopped: true, forced: false };
    }
    let forced = false;
    try {
      process.kill(s.pid, "SIGTERM");
    } catch {
      /* already dead */
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        process.kill(s.pid, 0);
        await new Promise((r) => setTimeout(r, 100));
      } catch {
        break;
      }
    }
    try {
      process.kill(s.pid, 0);
      process.kill(s.pid, "SIGKILL");
      forced = true;
    } catch {
      /* gone */
    }
    this.appendLog(`stopped daemon (pid ${s.pid}, forced=${forced})`);
    this.state.write({ autonomous: false, logFile: LOG_FILE() });
    return { stopped: true, forced };
  }
}

function defaultCliPath(): string {
  // Prefer the built CLI next to the running source.
  const here = process.cwd();
  const candidates = [
    join(here, "dist", "cli.js"),
    join(process.env.CODER_HOME ?? "", "dist", "cli.js"),
  ];
  return candidates.find((p) => existsSync(p)) ?? join(here, "dist", "cli.js");
}

/** Pet idle message per the Phase 11 spec. */
export const PET_IDLE_MESSAGE = "Awaiting instructions.";
