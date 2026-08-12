import type { Env } from "../../src/env";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    __TEST_MIGRATIONS: { name: string; queries: string[] }[];
  }
}
