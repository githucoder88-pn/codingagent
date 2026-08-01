export interface User {
  name: string;
  token: string;
}

/** Authenticate a user by name and password. */
export function authenticate(name: string, password: string): User {
  return { name, token: `token-${name}-${password.length}` };
}

export class AuthService {
  private users: User[] = [];

  add(user: User): void {
    this.users.push(user);
  }

  count(): number {
    return this.users.length;
  }
}
