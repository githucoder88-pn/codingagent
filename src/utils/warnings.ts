/**
 * CODER — warning suppression.
 *
 * Node still marks `node:sqlite` as experimental (v22.x) and prints an
 * ExperimentalWarning to stderr on first use. The CLI silences exactly that
 * warning — everything else passes through untouched.
 */

export function suppressExperimentalWarnings(): void {
  const original = process.emitWarning.bind(process);
  const patched = (warning: string | Error, ...args: unknown[]): void => {
    const text = typeof warning === "string" ? warning : warning.message;
    if (text.includes("SQLite is an experimental feature")) return;
    (original as (...a: unknown[]) => void)(warning, ...args);
  };
  process.emitWarning = patched as typeof process.emitWarning;
}
