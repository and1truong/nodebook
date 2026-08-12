import { defineConfig } from "vitest/config";

// Unit tests: pure logic (recurrence, references, auth crypto, time math).
// Integration tests run under the Workers runtime via vitest.integration.config.ts.
export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
  },
});
