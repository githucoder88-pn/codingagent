/**
 * CODER — execution modes (Phase 5 / 11).
 *
 * A single, authoritative enum for where and how a task runs. Every
 * command that accepts `--mode` resolves through `ExecutionMode`. The
 * offline-first runtime (Phase 11) adds `offline`.
 */

export const ExecutionMode = {
  LOCAL: "local",
  HYBRID: "hybrid",
  CLOUD: "cloud",
  AGENT: "agent",
  ENTERPRISE: "enterprise",
  ORGANIZATION: "organization",
  OFFLINE: "offline",
} as const;

export type ExecutionModeId = (typeof ExecutionMode)[keyof typeof ExecutionMode];

export const ALL_EXECUTION_MODES: ExecutionModeId[] = [
  ExecutionMode.LOCAL,
  ExecutionMode.HYBRID,
  ExecutionMode.CLOUD,
  ExecutionMode.AGENT,
  ExecutionMode.ENTERPRISE,
  ExecutionMode.ORGANIZATION,
  ExecutionMode.OFFLINE,
];

/** Parse and validate a mode string. Throws on unknown values. */
export function parseMode(value: string | undefined): ExecutionModeId {
  if (!value) return ExecutionMode.LOCAL;
  const v = value.toLowerCase();
  const found = ALL_EXECUTION_MODES.find((m) => m === v);
  if (!found) {
    throw new Error(
      `Unknown execution mode "${value}". Valid: ${ALL_EXECUTION_MODES.join(", ")}.`,
    );
  }
  return found;
}

/** True when a mode requires (or strongly prefers) the backend control plane. */
export function modeRequiresBackend(mode: ExecutionModeId): boolean {
  return mode === ExecutionMode.CLOUD || mode === ExecutionMode.ENTERPRISE || mode === ExecutionMode.ORGANIZATION;
}

/** True when a mode must never touch the network. */
export function modeIsOffline(mode: ExecutionModeId): boolean {
  return mode === ExecutionMode.OFFLINE;
}
