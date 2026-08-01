/**
 * Test helpers: isolated CODER_HOME per test.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

let current: string | null = null;

export function tempHome(): string {
  if (!current) {
    current = mkdtempSync(join(tmpdir(), "coder-test-"));
    process.env.CODER_HOME = current;
  }
  return current;
}

export function cleanupTempHome(): void {
  if (current) {
    rmSync(current, { recursive: true, force: true });
    current = null;
    delete process.env.CODER_HOME;
  }
}

/** Register vitest hooks that isolate every test in its own CODER_HOME. */
export function useTempHome(): void {
  beforeEach(() => {
    cleanupTempHome();
    tempHome();
  });
  afterEach(() => {
    cleanupTempHome();
  });
}
