/**
 * CODER — themes.
 *
 * ANSI colour themes for the CLI. `none` disables all styling; colours are
 * also stripped automatically when stdout is not a TTY or when NO_COLOR is
 * set. Themes are referenced from config (`theme` key) and can be extended
 * by adding an entry to THEMES.
 */

export interface Theme {
  accent: string;
  dim: string;
  muted: string;
  success: string;
  error: string;
  warning: string;
  bold: string;
  reset: string;
}

const CODES = {
  cyan: "\u001b[36m",
  magenta: "\u001b[35m",
  blue: "\u001b[34m",
  green: "\u001b[32m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  dim: "\u001b[2m",
  bold: "\u001b[1m",
  reset: "\u001b[0m",
} as const;

export const THEMES: Record<string, Theme> = {
  default: {
    accent: CODES.cyan,
    dim: CODES.dim,
    muted: CODES.dim,
    success: CODES.green,
    error: CODES.red,
    warning: CODES.yellow,
    bold: CODES.bold,
    reset: CODES.reset,
  },
  dark: {
    accent: CODES.magenta,
    dim: CODES.dim,
    muted: CODES.dim,
    success: CODES.green,
    error: CODES.red,
    warning: CODES.yellow,
    bold: CODES.bold,
    reset: CODES.reset,
  },
  light: {
    accent: CODES.blue,
    dim: CODES.dim,
    muted: CODES.dim,
    success: CODES.green,
    error: CODES.red,
    warning: CODES.yellow,
    bold: CODES.bold,
    reset: CODES.reset,
  },
  none: {
    accent: "",
    dim: "",
    muted: "",
    success: "",
    error: "",
    warning: "",
    bold: "",
    reset: "",
  },
};

const EMPTY_THEME: Theme = {
  accent: "",
  dim: "",
  muted: "",
  success: "",
  error: "",
  warning: "",
  bold: "",
  reset: "",
};

/** Resolve a theme by name; falls back to "default". */
export function getTheme(name: string): Theme {
  const theme = THEMES[name];
  if (theme) return theme;
  return THEMES["default"] ?? EMPTY_THEME;
}

/** True when ANSI colours may be used on the given stream. */
export function colorEnabled(stream: { isTTY?: boolean } = process.stdout): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.CODER_NO_COLOR !== undefined) return false;
  if (stream.isTTY !== true) return false;
  return true;
}

/** Theme with colours stripped (for non-TTY output). */
export function effectiveTheme(name: string, opts?: { enabled?: boolean }): Theme {
  const enabled = opts?.enabled ?? colorEnabled();
  return enabled ? getTheme(name) : EMPTY_THEME;
}
