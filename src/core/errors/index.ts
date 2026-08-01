/**
 * CODER — error hierarchy.
 *
 * Every failure surfaces as a `CoderError` subclass carrying a stable exit
 * code, so the CLI can fail loudly and predictably and scripts can react.
 */

import { EXIT } from "../constants/index.js";

export class CoderError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number = EXIT.ERROR, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.exitCode = exitCode;
  }
}

/** Invalid CLI usage (bad flags, unknown values). */
export class UsageError extends CoderError {
  constructor(message: string) {
    super(message, EXIT.USAGE);
  }
}

/** Configuration problems (~/.coder/config.json invalid, missing keys). */
export class ConfigError extends CoderError {
  constructor(message: string) {
    super(message, EXIT.CONFIG);
  }
}

/** Authentication problems (missing/invalid API key). */
export class AuthError extends CoderError {
  constructor(message: string) {
    super(message, EXIT.AUTH);
  }
}

/** Network/transport failures (DNS, timeouts, HTTP 5xx). */
export class NetworkError extends CoderError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, EXIT.NETWORK, options);
  }
}

/** Provider-level failures (HTTP 4xx, malformed payloads, stream errors). */
export class ProviderError extends CoderError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, EXIT.PROVIDER, options);
  }
}

/** Session/storage failures (corrupt files, IO errors). */
export class SessionError extends CoderError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, EXIT.ERROR, options);
  }
}

/** Turn any thrown value into a CoderError (used by the top-level handler). */
export function toCoderError(err: unknown): CoderError {
  if (err instanceof CoderError) return err;
  if (err instanceof Error) return new CoderError(err.message, EXIT.ERROR, { cause: err });
  return new CoderError(String(err), EXIT.ERROR);
}
