/**
 * CODER — command sandbox.
 *
 * Deny-list of destructive/unsafe shell patterns. The sandbox is not a
 * security boundary (no OS isolation); it is a guardrail that prevents the
 * most damaging commands from running at any permission level.
 */

const DENIED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+(-[a-z]*r[a-z]*\s*)+.*\/\s*(\*|$)/, reason: "recursive root deletion" },
  { pattern: /rm\s+-[a-z]*r[a-z]*\s+(?:\/|~|\.\s*$)/, reason: "recursive deletion of a root path" },
  { pattern: /\bmkfs\b/, reason: "filesystem formatting" },
  { pattern: /\bdd\s+if=/, reason: "raw device writes" },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\}\s*;/, reason: "fork bomb" },
  { pattern: />\s*\/dev\/(sd|hd)[a-z]/, reason: "raw block device write" },
  { pattern: /chmod\s+-R\s+[0-7]+\s+\//, reason: "recursive chmod on root" },
  { pattern: /\bgit\s+push\s+(-f|--force)/, reason: "force push" },
  { pattern: /\bgit\s+reset\s+--hard/, reason: "hard reset (use git_restore tool instead)" },
  { pattern: /\bgit\s+clean\s+-[a-z]*f/, reason: "untracked-file deletion" },
  { pattern: /\bshutdown\b|\breboot\b|\bhalt\b/, reason: "system shutdown" },
  { pattern: /\bcurl\b.*\|\s*(?:ba)?sh\b/, reason: "pipe-to-shell execution" },
];

export function isDeniedCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, " ");
  return DENIED_PATTERNS.some(({ pattern, reason }) => {
    if (pattern.test(normalized)) {
      pattern.lastIndex = 0;
      return true;
    }
    void reason;
    return false;
  });
}

/** Commands always allowed (read-only diagnostics). */
export const ALLOWED_SAFE_PREFIXES = ["git status", "git diff", "git log", "git branch", "ls", "pwd", "cat ", "head ", "tail ", "find ", "grep ", "node --version", "npm --version", "python3 --version", "go version", "cargo --version"];

export function isSafeCommand(command: string): boolean {
  return ALLOWED_SAFE_PREFIXES.some((prefix) => command.trim().startsWith(prefix));
}
