/**
 * CODER — interactive prompts.
 *
 * readline-based prompts that work on any terminal: plain text, hidden
 * (API keys), yes/no confirm and numbered selection. All of them resolve
 * `null` when the input stream is not interactive (so the CLI can degrade
 * gracefully in scripts and CI).
 */

import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { isTty } from "../../utils/tty.js";

export interface PromptOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

interface WritableWithWrite {
  write: (chunk: unknown, ...args: unknown[]) => unknown;
}

function makeInterface(opts?: PromptOptions) {
  return createInterface({
    input: (opts?.input ?? stdin) as NodeJS.ReadableStream,
    output: (opts?.output ?? stdout) as NodeJS.WritableStream,
    terminal: true,
  });
}

/** Ask a plain-text question. Resolves null when input is not interactive. */
export function promptText(question: string, opts?: PromptOptions): Promise<string | null> {
  if (!isTty((opts?.input ?? stdin) as { isTTY?: boolean })) {
    (opts?.output ?? stdout).write(`${question}\n`);
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const rl = makeInterface(opts);
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
    rl.on("SIGINT", () => {
      rl.close();
      resolve(null);
    });
  });
}

/**
 * Ask a question with hidden input (API keys). Echoed characters are
 * swallowed; the question itself is still printed.
 */
export function promptHidden(question: string, opts?: PromptOptions): Promise<string | null> {
  if (!isTty((opts?.input ?? stdin) as { isTTY?: boolean })) {
    (opts?.output ?? stdout).write(`${question}\n`);
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const rl = makeInterface(opts);
    const output = (rl as unknown as { output: WritableWithWrite }).output;
    const originalWrite = output.write.bind(output);
    output.write = ((chunk: unknown, ...args: unknown[]) => {
      const text = String(chunk);
      if (text.includes(question) || text.includes("\n") || text.includes("\r")) {
        return originalWrite(chunk, ...args);
      }
      return true; // swallow echoed key characters
    }) as WritableWithWrite["write"];
    rl.question(question, (answer) => {
      output.write = originalWrite;
      rl.close();
      resolve(answer);
    });
    rl.on("SIGINT", () => {
      output.write = originalWrite;
      rl.close();
      resolve(null);
    });
  });
}

/** Yes/no confirmation. Defaults to `defaultYes` on empty input. */
export function promptConfirm(question: string, defaultYes = true, opts?: PromptOptions): Promise<boolean | null> {
  const suffix = defaultYes ? " [Y/n]" : " [y/N]";
  return promptText(`${question}${suffix} `, opts).then((answer) => {
    if (answer === null) return null;
    const normalized = answer.trim().toLowerCase();
    if (normalized === "") return defaultYes;
    if (["y", "yes"].includes(normalized)) return true;
    if (["n", "no"].includes(normalized)) return false;
    return defaultYes;
  });
}

/** Numbered list selection. Resolves null on non-interactive input. */
export async function promptSelect<T>(
  question: string,
  items: Array<{ value: T; label: string }>,
  opts?: PromptOptions,
): Promise<T | null> {
  const out = opts?.output ?? stdout;
  out.write(`${question}\n`);
  items.forEach((item, i) => out.write(`  ${i + 1}. ${item.label}\n`));
  const answer = await promptText(`Select 1-${items.length}: `, opts);
  if (answer === null) return null;
  const index = Number.parseInt(answer.trim(), 10) - 1;
  const item = items[index];
  if (!item) {
    out.write(`Invalid selection "${answer}".\n`);
    return promptSelect(question, items, opts);
  }
  return item.value;
}
