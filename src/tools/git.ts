/**
 * CODER — git tools.
 *
 * git_status, git_diff, git_commit, git_branch, git_checkout, git_restore,
 * git_log. Backed by the system git binary (read-only ops are safe-level;
 * mutations require balanced/full-auto).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type ToolDefinition, type ToolContext } from "./types.js";
import { type ToolResult } from "../workspace/types.js";

const exec = promisify(execFile);

async function git(args: string[], cwd: string, log?: (m: string) => void): Promise<ToolResult> {
  log?.(`$ git ${args.join(" ")}`);
  try {
    const { stdout, stderr } = await exec("git", args, { cwd, maxBuffer: 2 * 1024 * 1024 });
    const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
    return { ok: true, output: output || "(no output)" };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    return { ok: false, output: [e.stdout?.trim(), e.stderr?.trim()].filter(Boolean).join("\n"), error: e.message };
  }
}

export const gitTools: ToolDefinition[] = [
  {
    id: "git_status",
    name: "Git status",
    description: "Show the working tree status.",
    level: "safe",
    mutating: false,
    params: [],
    async execute(_params, ctx: ToolContext) {
      return git(["status", "--short", "--branch"], ctx.cwd, ctx.log);
    },
  },
  {
    id: "git_diff",
    name: "Git diff",
    description: "Show unstaged changes (optionally staged with `staged`).",
    level: "safe",
    mutating: false,
    params: [{ name: "staged", type: "boolean", description: "Diff the index instead" }],
    async execute(params, ctx: ToolContext) {
      return params.staged ? git(["diff", "--cached"], ctx.cwd, ctx.log) : git(["diff"], ctx.cwd, ctx.log);
    },
  },
  {
    id: "git_log",
    name: "Git log",
    description: "Show recent commit history.",
    level: "safe",
    mutating: false,
    params: [{ name: "count", type: "number", description: "Number of commits (default 10)" }],
    async execute(params, ctx: ToolContext) {
      return git(["log", `-n`, String(params.count ?? 10), "--pretty=format:%h %ad %an %s", "--date=short"], ctx.cwd, ctx.log);
    },
  },
  {
    id: "git_branch",
    name: "Git branch",
    description: "List branches (optionally create one with `name`).",
    level: "safe",
    mutating: false,
    params: [{ name: "name", type: "string", description: "Create a branch with this name" }],
    async execute(params, ctx: ToolContext) {
      return params.name ? git(["checkout", "-b", String(params.name)], ctx.cwd, ctx.log) : git(["branch", "-a"], ctx.cwd, ctx.log);
    },
  },
  {
    id: "git_commit",
    name: "Git commit",
    description: "Stage all changes and commit with a message.",
    level: "balanced",
    mutating: true,
    params: [
      { name: "message", type: "string", required: true, description: "Commit message" },
      { name: "all", type: "boolean", description: "Stage all changes first (default true)" },
    ],
    async execute(params, ctx: ToolContext) {
      const message = String(params.message ?? "");
      if (!message.trim()) return { ok: false, output: "", error: "commit message required" };
      if (params.all !== false) {
        const add = await git(["add", "-A"], ctx.cwd, ctx.log);
        if (!add.ok) return add;
      }
      return git(["commit", "-m", message], ctx.cwd, ctx.log);
    },
  },
  {
    id: "git_checkout",
    name: "Git checkout",
    description: "Switch to an existing branch (or create with `create`).",
    level: "balanced",
    mutating: true,
    params: [
      { name: "branch", type: "string", required: true, description: "Branch name" },
      { name: "create", type: "boolean", description: "Create the branch if missing" },
    ],
    async execute(params, ctx: ToolContext) {
      const branch = String(params.branch ?? "");
      if (!branch) return { ok: false, output: "", error: "branch required" };
      const args = params.create ? ["checkout", "-b", branch] : ["checkout", branch];
      return git(args, ctx.cwd, ctx.log);
    },
  },
  {
    id: "git_restore",
    name: "Git restore",
    description: "Restore a file (or all files) from the last commit.",
    level: "balanced",
    mutating: true,
    params: [{ name: "path", type: "string", description: "File path (default: all)" }],
    async execute(params, ctx: ToolContext) {
      const path = String(params.path ?? ".");
      const args = path === "." ? ["checkout", "--", "."] : ["checkout", "--", path];
      return git(args, ctx.cwd, ctx.log);
    },
  },
];
