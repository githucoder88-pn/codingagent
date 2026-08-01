import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/fixtures/**", "node_modules/**", "dist/**"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // E2E tests spawn the built CLI; give them a bit of room.
    fileParallelism: false,
    pool: "forks",
  },
});
