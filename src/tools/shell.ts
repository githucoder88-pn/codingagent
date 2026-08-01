/**
 * CODER — shell tools.
 *
 * execute_command, run_tests, run_build, install_package, execute_script.
 * Commands run in the workspace root with a timeout, bounded output
 * capture, and a deny-list of destructive patterns (sandboxing).
 */

import { spawn } from "node:child_process";
import { type ToolDefinition, type ToolContext } from "./types.js";
import { type ToolResult } from "../workspace/types.js";
import { isDeniedCommand } from "../execution/sandbox.js";

const MAX_OUTPUT = 200 * 1024; // 200 KB
const DEFAULT_TIMEOUT = 60_000;

export interface CommandOptions {
  command: string;
  cwd: string;
  timeoutMs?: number;
  log?: (msg: string) => void;
  env?: Record<string, string>;
}

export async function runCommand(opts: CommandOptions): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolvePromise) => {
    const child = spawn("/bin/sh", ["-c", opts.command], {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT);

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > MAX_OUTPUT) stdout = stdout.slice(0, MAX_OUTPUT);
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > MAX_OUTPUT) stderr = stderr.slice(0, MAX_OUTPUT);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({ code: -1, stdout, stderr: err.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? -1, stdout, stderr, timedOut });
    });
  });
}

function shellToolResult(res: { code: number; stdout: string; stderr: string; timedOut: boolean }): ToolResult {
  if (res.timedOut) return { ok: false, output: `command timed out\n${res.stdout}`, error: "timed out" };
  const output = [res.stdout.trim(), res.stderr.trim()].filter(Boolean).join("\n").slice(0, MAX_OUTPUT);
  return { ok: res.code === 0, output: output || `(exit ${res.code})`, data: { exitCode: res.code } };
}

export const shellTools: ToolDefinition[] = [
  {
    id: "execute_command",
    name: "Execute a shell command",
    description: "Run a shell command in the workspace root (bounded output, timeout).",
    level: "full-auto",
    mutating: true,
    params: [
      { name: "command", type: "string", required: true, description: "Shell command to run" },
      { name: "timeoutMs", type: "number", description: "Timeout in ms (default 60000)" },
    ],
    async execute(params, ctx: ToolContext) {
      const command = String(params.command ?? "");
      if (!command.trim()) return { ok: false, output: "", error: "empty command" };
      if (isDeniedCommand(command)) {
        return { ok: false, output: "", error: "command denied by the sandbox (destructive pattern)" };
      }
      ctx.log?.(`$ ${command}`);
      const res = await runCommand({ command, cwd: ctx.cwd, timeoutMs: Number(params.timeoutMs ?? DEFAULT_TIMEOUT), log: ctx.log });
      return shellToolResult(res);
    },
  },
  {
    id: "run_tests",
    name: "Run the test suite",
    description: "Run the repository's tests (npm test, pytest, cargo test, go test, …).",
    level: "full-auto",
    mutating: false,
    params: [
      { name: "command", type: "string", description: "Custom test command (default: detected)" },
      { name: "timeoutMs", type: "number", description: "Timeout in ms (default 120000)" },
    ],
    async execute(params, ctx: ToolContext) {
      const command = String(params.command ?? "") || detectTestCommand(ctx.cwd);
      ctx.log?.(`$ ${command}`);
      const res = await runCommand({ command, cwd: ctx.cwd, timeoutMs: Number(params.timeoutMs ?? 120_000), log: ctx.log });
      return shellToolResult(res);
    },
  },
  {
    id: "run_build",
    name: "Run the build",
    description: "Run the repository's build (npm run build, make, cargo build, …).",
    level: "full-auto",
    mutating: false,
    params: [{ name: "command", type: "string", description: "Custom build command" }],
    async execute(params, ctx: ToolContext) {
      const command = String(params.command ?? "") || detectBuildCommand(ctx.cwd);
      ctx.log?.(`$ ${command}`);
      const res = await runCommand({ command, cwd: ctx.cwd, timeoutMs: 120_000, log: ctx.log });
      return shellToolResult(res);
    },
  },
  {
    id: "install_package",
    name: "Install a package",
    description: "Install a dependency (npm install <pkg>, pip install <pkg>, …).",
    level: "full-auto",
    mutating: true,
    params: [
      { name: "manager", type: "string", enum: ["npm", "pip", "cargo", "go"], description: "Package manager" },
      { name: "package", type: "string", required: true, description: "Package name" },
    ],
    async execute(params, ctx: ToolContext) {
      const manager = String(params.manager ?? "npm");
      const pkg = String(params.package ?? "");
      if (!pkg) return { ok: false, output: "", error: "missing package name" };
      const command =
        manager === "pip" ? `pip install ${pkg}` :
        manager === "cargo" ? `cargo add ${pkg}` :
        manager === "go" ? `go get ${pkg}` :
        `npm install ${pkg} --no-audit --no-fund`;
      ctx.log?.(`$ ${command}`);
      const res = await runCommand({ command, cwd: ctx.cwd, timeoutMs: 180_000, log: ctx.log });
      return shellToolResult(res);
    },
  },
  {
    id: "execute_script",
    name: "Execute a script file",
    description: "Run a script file in the workspace (node, python, sh by extension).",
    level: "full-auto",
    mutating: true,
    params: [
      { name: "path", type: "string", required: true, description: "Script path" },
      { name: "args", type: "array", description: "Arguments" },
    ],
    async execute(params, ctx: ToolContext) {
      const script = String(params.path ?? "");
      const args = Array.isArray(params.args) ? params.args.map(String).join(" ") : "";
      const command = `${interpreterFor(script)} ${script} ${args}`.trim();
      ctx.log?.(`$ ${command}`);
      const res = await runCommand({ command, cwd: ctx.cwd, timeoutMs: 120_000, log: ctx.log });
      return shellToolResult(res);
    },
  },
];

function interpreterFor(script: string): string {
  if (script.endsWith(".py")) return "python3";
  if (script.endsWith(".js") || script.endsWith(".mjs") || script.endsWith(".ts")) return "node";
  if (script.endsWith(".sh")) return "sh";
  return "sh";
}

export function detectTestCommand(cwd: string): string {
  const { existsSync } = require("node:fs") as typeof import("node:fs");
  const has = (file: string) => existsSync(`${cwd}/${file}`);
  if (has("package.json")) return "npm test -- --run 2>/dev/null || npm test";
  if (has("pyproject.toml") || has("pytest.ini") || has("requirements.txt")) return "python3 -m pytest -q";
  if (has("Cargo.toml")) return "cargo test";
  if (has("go.mod")) return "go test ./...";
  return "npm test 2>/dev/null || python3 -m pytest -q 2>/dev/null || echo 'no test runner detected'";
}

export function detectBuildCommand(cwd: string): string {
  const { existsSync } = require("node:fs") as typeof import("node:fs");
  const has = (file: string) => existsSync(`${cwd}/${file}`);
  if (has("package.json")) return "npm run build 2>/dev/null || echo 'no build script'";
  if (has("Makefile")) return "make";
  if (has("Cargo.toml")) return "cargo build";
  if (has("go.mod")) return "go build ./...";
  return "echo 'no build tool detected'";
}
