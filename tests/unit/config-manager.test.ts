import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { ConfigManager } from "../../src/config/manager/config-manager.js";
import { paths } from "../../src/utils/paths.js";
import { ConfigError, AuthError } from "../../src/core/errors/index.js";
import { useTempHome } from "../helpers/temp-home.js";

useTempHome();

describe("ConfigManager", () => {
  it("starts with defaults when no config file exists", () => {
    const config = new ConfigManager();
    expect(config.all()).toEqual({ provider: "openrouter", model: null, theme: "default", stream: true });
  });

  it("persists values to config.json", () => {
    const config = new ConfigManager();
    config.set("provider", "anthropic");
    config.set("model", "claude-sonnet-4");
    config.set("stream", false);

    const fresh = new ConfigManager();
    expect(fresh.get("provider")).toBe("anthropic");
    expect(fresh.get("model")).toBe("claude-sonnet-4");
    expect(fresh.get("stream")).toBe(false);
    expect(fresh.get("theme")).toBe("default");
  });

  it("rejects invalid values", () => {
    const config = new ConfigManager();
    expect(() => config.set("theme", "neon" as never)).toThrow(ConfigError);
    expect(() => config.set("stream", "yes" as never)).toThrow(ConfigError);
  });

  it("surfaces corrupt config files as ConfigError", () => {
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(paths.config(), "{ not json");
    expect(() => new ConfigManager()).toThrow(ConfigError);
  });

  it("applies environment overrides to settings()", () => {
    const config = new ConfigManager();
    config.set("provider", "openai");
    process.env.CODER_PROVIDER = "gemini";
    process.env.CODER_MODEL = "gemini-2.5-flash";
    process.env.CODER_STREAM = "0";
    try {
      expect(config.settings()).toMatchObject({ provider: "gemini", model: "gemini-2.5-flash", stream: false });
    } finally {
      delete process.env.CODER_PROVIDER;
      delete process.env.CODER_MODEL;
      delete process.env.CODER_STREAM;
    }
  });

  it("stores and retrieves API keys (encrypted vault)", () => {
    const config = new ConfigManager();
    config.setApiKey("openai", "sk-test-123");
    expect(config.getApiKey("openai")).toBe("sk-test-123");
    expect(config.getAccount("openai")).toMatchObject({ apiKey: "sk-test-123" });
  });

  it("writes the vault with 0600 permissions and never plaintext", () => {
    const config = new ConfigManager();
    config.setApiKey("openai", "sk-secret-123");
    const mode = statSync(paths.vault()).mode & 0o777;
    expect(mode).toBe(0o600);
    const raw = readFileSync(paths.vault(), "utf8");
    expect(raw).not.toContain("sk-secret-123"); // encrypted at rest
    expect(raw).toMatch(/^v1\./); // versioned envelope
    expect(readFileSync(`${paths.root()}/keys/master.key`, "utf8").trim().length).toBe(64);
  });

  it("migrates a legacy plaintext providers.json into the vault", () => {
    const { writeFileSync, existsSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(
      paths.providers(),
      JSON.stringify({ anthropic: { apiKey: "sk-ant-legacy-123", configuredAt: new Date().toISOString() } }),
    );
    const config = new ConfigManager();
    expect(config.getApiKey("anthropic")).toBe("sk-ant-legacy-123");
    expect(existsSync(paths.providers())).toBe(false); // renamed away
    expect(existsSync(`${paths.providers()}.migrated`)).toBe(true);
    const rawVault = readFileSync(paths.vault(), "utf8");
    expect(rawVault).not.toContain("sk-ant-legacy-123");
  });

  it("throws AuthError when a key is missing", () => {
    const config = new ConfigManager();
    expect(() => config.getApiKey("anthropic")).toThrow(AuthError);
  });

  it("removes API keys", () => {
    const config = new ConfigManager();
    config.setApiKey("openai", "sk-1");
    expect(config.removeApiKey("openai")).toBe(true);
    expect(config.removeApiKey("openai")).toBe(false);
    expect(config.getAccount("openai")).toBeUndefined();
  });

  it("keeps a custom base URL override", () => {
    const config = new ConfigManager();
    config.setApiKey("openai", "sk-1", "https://proxy.example.com/v1");
    expect(config.getAccount("openai")?.baseUrl).toBe("https://proxy.example.com/v1");
  });
});
