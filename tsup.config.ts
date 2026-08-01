import { defineConfig } from "tsup";

/**
 * CODER build configuration.
 *
 * Three bundles from one build:
 *   - dist/cli.js    — the CLI (bin: coder)
 *   - dist/index.js  — programmatic API
 *   - dist/server.js — the Phase 2 backend control plane
 *
 * Runtime dependencies stay external (proper npm packages installed with
 * the CLI); the web dashboard is copied into dist/web (publicDir) and
 * served by the backend.
 */
export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
    server: "backend/src/index.ts",
  },
  format: ["esm"],
  target: "node22",
  platform: "node",
  bundle: true,
  external: ["commander", "pino", "zod", "ink", "react", "express"],
  treeshake: true,
  minify: false,
  sourcemap: false,
  clean: true,
  splitting: false,
  dts: false,
  publicDir: "web",
  banner: {
    js: "#!/usr/bin/env node",
  },
  outDir: "dist",
});
