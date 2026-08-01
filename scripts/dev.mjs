#!/usr/bin/env node
/**
 * CODER dev runner: `npm run dev -- <args>` executes the CLI from source
 * with tsx (no build step needed).
 *
 *   npm run dev -- ask "hello"
 *   npm run dev -- chat
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(root, "src", "cli.ts");
const args = process.argv.slice(2);

const child = spawn("node", ["--import", "tsx", entry, ...args], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code) => process.exit(code ?? 1));
