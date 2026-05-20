import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "happy-dom",
    include: ["tests/*.test.ts"],
    reporters: ["agent"],
    silent: "passed-only",
    sequence: { shuffle: true },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      thresholds: {
        lines: 75,
        functions: 80,
      },
    },
  },
});
