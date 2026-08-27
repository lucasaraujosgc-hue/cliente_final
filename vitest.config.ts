import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Server code + shared pure-logic libs (no DOM). No frontend component tests.
    include: ["src/server/**/*.test.ts", "src/lib/**/*.test.ts"],
  },
});
