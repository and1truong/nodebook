import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

// Integration tests run inside the Workers runtime (workerd) with real D1, R2,
// and Durable Object bindings. Migrations are read from disk at config time and
// passed to the test setup through a binding; test/integration/setup.ts applies
// them to the per-file D1 database.
export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations("migrations");
  return {
    test: {
      include: ["test/integration/**/*.test.ts"],
      setupFiles: ["test/integration/setup.ts"],
      poolOptions: {
        workers: {
          main: "./src/worker.ts",
          miniflare: {
            compatibilityDate: "2025-02-01",
            // Required by the vitest-pool-workers harness itself; the NodeBook
            // application does not use nodejs_compat (see wrangler.jsonc).
            compatibilityFlags: ["nodejs_compat"],
            d1Databases: {
              DB: "nodebook-test",
            },
            r2Buckets: {
              FILES: "nodebook-test-files",
            },
            durableObjects: {
              MCP_SESSION: "McpSession",
            },
            bindings: {
              OWNER_EMAIL: "owner@test.dev",
              OWNER_DISPLAY_NAME: "Test Owner",
              OWNER_TIMEZONE: "UTC",
              ACCESS_TEAM: "",
              ACCESS_AUD: "",
              AUTH_DEV_EMAIL: "owner@test.dev",
              MAX_UPLOAD_BYTES: "26214400",
              MCP_MAX_UPLOAD_BYTES: "5242880",
              MCP_CORS_ORIGINS: "",
              OAUTH_ISSUER: "https://nodebook.test",
              CALENDAR_DEFAULT_VIEW: "week",
              WEEK_START_DAY: "sunday",
              ISSUES_DEFAULT_LIMIT: "20",
              CHAT_CREDENTIAL_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
              __TEST_MIGRATIONS: migrations,
            },
          },
        },
      },
    },
  };
});
