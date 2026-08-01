/**
 * CODER — TTY detection helpers.
 */

export function isTty(stream: { isTTY?: boolean }): boolean {
  return stream.isTTY === true;
}
