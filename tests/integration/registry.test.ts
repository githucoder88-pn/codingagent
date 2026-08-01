/**
 * Integration tests: ProviderRegistry (model caching, offline fallback)
 * and the full application flow (createApp → runAsk → persistence).
 */

import { describe, expect, it } from "vitest";
import { createApp } from "../../src/core/application/application.js";
import { ProviderRegistry } from "../../src/providers/registry.js";
import { ModelCache } from "../../src/providers/model-cache.js";
import { SqliteStore } from "../../src/session/storage/sqlite-store.js";
import { MockProvider } from "../../src/providers/mock/mock.provider.js";
import { type Provider } from "../../src/providers/base/provider.interface.js";
import { runAsk } from "../../src/ui/screens/ask.js";
import { useTempHome } from "../helpers/temp-home.js";

useTempHome();

/** Wrap a provider, overriding listModels with a counting version. */
function wrapProvider(mock: MockProvider, count: () => void): Provider {
  return {
    id: mock.id,
    name: mock.name,
    defaultModel: mock.defaultModel,
    requiresKey: mock.requiresKey,
    initialize: () => mock.initialize(),
    authenticate: (k) => mock.authenticate(k),
    listModels: async () => {
      count();
      return mock.listModels();
    },
    chat: (r) => mock.chat(r),
    stream: (r) => mock.stream(r),
  };
}

async function registryWithCache(): Promise<{ registry: ProviderRegistry; store: SqliteStore; fetches: () => number }> {
  const store = new SqliteStore();
  const cache = new ModelCache(store);
  const registry = new ProviderRegistry(cache);
  const mock = new MockProvider();
  let fetches = 0;
  registry.register(wrapProvider(mock, () => (fetches += 1)));
  return { registry, store, fetches: () => fetches };
}

describe("ProviderRegistry model caching", () => {
  it("caches listings and serves them from the cache", async () => {
    const { registry, store, fetches } = await registryWithCache();
    try {
      const first = await registry.listModels("mock");
      const second = await registry.listModels("mock");
      expect(first.length).toBeGreaterThan(0);
      expect(second).toEqual(first);
      expect(fetches()).toBe(1);
    } finally {
      await store.close();
    }
  });

  it("refreshes when asked", async () => {
    const { registry, store, fetches } = await registryWithCache();
    try {
      await registry.listModels("mock");
      await registry.listModels("mock", { refresh: true });
      expect(fetches()).toBe(2);
    } finally {
      await store.close();
    }
  });

  it("falls back to a stale cache when the provider fails", async () => {
    const store = new SqliteStore();
    const cache = new ModelCache(store);
    const registry = new ProviderRegistry(cache);
    const mock = new MockProvider();
    let failing = false;
    const provider = wrapProvider(mock, () => {});
    const originalList = provider.listModels.bind(provider);
    provider.listModels = async () => {
      if (failing) throw new Error("network down");
      return originalList();
    };
    registry.register(provider);

    await registry.listModels("mock"); // seeds the cache
    failing = true;
    const models = await registry.listModels("mock");
    expect(models.length).toBeGreaterThan(0);
    await store.close();
  });

  it("rethrows when there is no cache and the provider fails", async () => {
    const store = new SqliteStore();
    const cache = new ModelCache(store);
    const registry = new ProviderRegistry(cache);
    const mock = new MockProvider();
    const provider = wrapProvider(mock, () => {});
    provider.listModels = async () => {
      throw new Error("network down");
    };
    registry.register(provider);
    await expect(registry.listModels("mock")).rejects.toThrow(/network down/);
    await store.close();
  });

  it("resolves the active provider and default model", async () => {
    const { registry, store } = await registryWithCache();
    try {
      const resolved = registry.resolve("mock", null);
      expect(resolved.provider.id).toBe("mock");
      expect(resolved.model).toBe("mock/coder-1");
      const custom = registry.resolve("mock", "mock/echo");
      expect(custom.model).toBe("mock/echo");
      expect(() => registry.resolve("nope", null)).toThrow(/Unknown provider/);
    } finally {
      await store.close();
    }
  });
});

describe("Application flow (createApp → runAsk)", () => {
  it("runs a full ask round-trip and persists the session", async () => {
    const ctx = await createApp();
    ctx.config.set("provider", "mock");
    try {
      const result = await runAsk(ctx, { prompt: "Build a Todo application.", print: false });
      expect(result.response.content).toContain("Build a Todo application");
      expect(result.session.messages).toHaveLength(2);
      expect(result.session.messages[0]).toMatchObject({ role: "user" });
      expect(result.session.messages[1]).toMatchObject({ role: "assistant" });

      // A second ask continues the same session.
      const second = await runAsk(ctx, { prompt: "And add tests.", print: false });
      expect(second.session.id).toBe(result.session.id);
      expect(second.session.messages).toHaveLength(4);
    } finally {
      await ctx.container.disposeAll();
      ctx.logger.close();
    }
  });

  it("creates ~/.coder with the expected layout", async () => {
    const ctx = await createApp();
    try {
      const { existsSync } = await import("node:fs");
      const home = process.env.CODER_HOME!;
      for (const dir of ["", "/sessions", "/logs", "/cache"]) {
        expect(existsSync(`${home}${dir}`)).toBe(true);
      }
    } finally {
      await ctx.container.disposeAll();
      ctx.logger.close();
    }
  });

  it("rejects asks for unconfigured providers", async () => {
    const ctx = await createApp();
    try {
      await expect(runAsk(ctx, { prompt: "hi", provider: "openai", print: false })).rejects.toThrow(/No API key/);
    } finally {
      await ctx.container.disposeAll();
      ctx.logger.close();
    }
  });

  it("supports continue-in-session via sessionId", async () => {
    const ctx = await createApp();
    ctx.config.set("provider", "mock");
    try {
      const first = await runAsk(ctx, { prompt: "one", print: false });
      const resumed = await runAsk(ctx, { prompt: "two", sessionId: first.session.id, print: false });
      expect(resumed.session.id).toBe(first.session.id);
      expect(resumed.session.messages).toHaveLength(4);
      await expect(
        runAsk(ctx, { prompt: "x", sessionId: "session-999", print: false }),
      ).rejects.toThrow(/not found/);
    } finally {
      await ctx.container.disposeAll();
      ctx.logger.close();
    }
  });
});
