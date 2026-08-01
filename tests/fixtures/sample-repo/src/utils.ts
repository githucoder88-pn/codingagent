export function hashPassword(user: { token: string }): string {
  return `hash:${user.token}`;
}

export function formatToken(hash: string): string {
  return hash.toUpperCase();
}

export const VERSION = "1.0.0";
