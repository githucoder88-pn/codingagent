/**
 * CODER — dependency injection container.
 *
 * A tiny, dependency-free DI container. Services are registered with a
 * factory function and resolved lazily as singletons. Tests can re-register
 * a token to substitute mocks, which keeps every layer testable.
 */

export type Factory<T> = (container: Container) => T;

interface Registration {
  factory: Factory<unknown>;
  instance?: unknown;
  singleton: boolean;
}

export class Container {
  private readonly registrations = new Map<string, Registration>();

  /** Register a service. Factories run lazily on first resolve. */
  register<T>(token: string, factory: Factory<T>, opts?: { singleton?: boolean }): void {
    if (this.registrations.has(token)) {
      throw new Error(`Container: token "${token}" is already registered`);
    }
    this.registrations.set(token, {
      factory: factory as Factory<unknown>,
      singleton: opts?.singleton ?? true,
    });
  }

  /** Re-register an existing token (test doubles). */
  override<T>(token: string, factory: Factory<T>, opts?: { singleton?: boolean }): void {
    if (!this.registrations.has(token)) {
      throw new Error(`Container: token "${token}" is not registered`);
    }
    this.registrations.set(token, {
      factory: factory as Factory<unknown>,
      singleton: opts?.singleton ?? true,
    });
  }

  resolve<T>(token: string): T {
    const registration = this.registrations.get(token);
    if (!registration) {
      throw new Error(`Container: no service registered for token "${token}"`);
    }
    if (registration.singleton) {
      if (registration.instance === undefined) {
        registration.instance = registration.factory(this);
      }
      return registration.instance as T;
    }
    return registration.factory(this) as T;
  }

  has(token: string): boolean {
    return this.registrations.has(token);
  }

  /** Run a callback for every registered token (used by shutdown ordering). */
  tokens(): string[] {
    return [...this.registrations.keys()];
  }

  /** Dispose singleton instances that expose `close()`. */
  async disposeAll(): Promise<void> {
    interface Closer {
      token: string;
      instance: { close: () => Promise<void> | void };
    }
    const closers: Closer[] = [];
    for (const [token, reg] of this.registrations) {
      const instance = reg.instance as { close?: unknown } | undefined;
      if (reg.singleton && instance && typeof instance.close === "function") {
        closers.push({ token, instance: instance as Closer["instance"] });
      }
    }
    for (const { token, instance } of closers.reverse()) {
      try {
        await instance.close();
      } catch (err) {
        // Closing is best-effort during shutdown; never mask the original error.
        process.stderr.write(`[coder] failed to dispose "${token}": ${String(err)}\n`);
      }
    }
  }
}
