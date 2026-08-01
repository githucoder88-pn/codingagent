/**
 * CODER — git detection helpers.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

export function isGitRepo(root: string): boolean {
  return existsSync(join(root, ".git"));
}
