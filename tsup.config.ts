import { defineConfig } from "tsup";

/**
 * CODER build configuration.
 *
 * The CLI source is bundled into two self-contained ESM files
 * (`dist/cli.js` and `dist/index.js`). Runtime dependencies (commander,
 * zod, pino and the optional Ink/React UI) stay external: they are proper
 * npm packages installed alongside the CLI, and keeping them external
 * avoids CJS→ESM interop problems in the bundle.
 */
export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
  },
  format: ["esm"],
  target: "node22",
  platform: "node",
  bundle: true,
  external: ["commander", "pino", "zod", "ink", "react"],
  treeshake: true,
  minify: false,
  sourcemap: false,
  clean: true,
  splitting: false,
  dts: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
  outDir: "dist",
});
