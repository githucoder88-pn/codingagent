import { describe, expect, it } from "vitest";
import { Container } from "../../src/core/container/container.js";

describe("Container", () => {
  it("resolves lazily and caches singletons", () => {
    const container = new Container();
    let calls = 0;
    container.register("svc", () => {
      calls += 1;
      return { n: calls };
    });
    const a = container.resolve<{ n: number }>("svc");
    const b = container.resolve<{ n: number }>("svc");
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });

  it("resolves a fresh instance for non-singleton services", () => {
    const container = new Container();
    container.register("svc", () => ({}), { singleton: false });
    expect(container.resolve("svc")).not.toBe(container.resolve("svc"));
  });

  it("supports factories depending on other services", () => {
    const container = new Container();
    container.register("a", () => 21);
    container.register("b", (c) => c.resolve<number>("a") * 2);
    expect(container.resolve<number>("b")).toBe(42);
  });

  it("throws on unknown tokens and duplicate registration", () => {
    const container = new Container();
    expect(() => container.resolve("nope")).toThrow(/no service registered/);
    container.register("x", () => 1);
    expect(() => container.register("x", () => 2)).toThrow(/already registered/);
  });

  it("override() replaces an existing service (test doubles)", () => {
    const container = new Container();
    container.register("v", () => "real");
    container.override("v", () => "mock");
    expect(container.resolve<string>("v")).toBe("mock");
  });

  it("disposeAll() closes singleton instances in reverse registration order", async () => {
    const closed: string[] = [];
    const container = new Container();
    container.register("first", () => ({ close: () => void closed.push("first") }));
    container.register("second", () => ({ close: () => void closed.push("second") }));
    container.resolve("first");
    container.resolve("second");
    await container.disposeAll();
    expect(closed).toEqual(["second", "first"]);
  });
});
