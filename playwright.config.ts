import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:8787",
    trace: "retain-on-failure",
  },
  // The E2E suite exercises the real Worker: build the client bundle, then run
  // the Worker locally with fresh D1/R2/miniflare state under .wrangler/state.
  webServer: {
    command:
      "rm -rf .wrangler/state && npm run build && npx wrangler d1 migrations apply nodebook --local && npx wrangler dev --local --port 8787",
    url: "http://localhost:8787/healthz",
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
