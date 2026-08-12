/** Apply migrations to the per-file D1 database before each test file runs. */
import { applyD1Migrations, env } from "cloudflare:test";

const migrations = env.__TEST_MIGRATIONS as unknown as {
  name: string;
  queries: string[];
}[];

await applyD1Migrations(env.DB, migrations);
