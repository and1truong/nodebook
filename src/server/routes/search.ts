/** Search routes: full-text search and PRD search_knowledge semantics. */
import { Hono } from "hono";
import type { AppEnv } from "./helpers";
import { searchIssues, searchKnowledge } from "../services/search-service";
import { searchQuerySchema } from "../../shared/contracts/issues";

export const searchRoutes = new Hono<AppEnv>();

function parseQuery(c: { req: { query: (k: string) => string | undefined } }) {
  return searchQuerySchema.parse({
    q: c.req.query("q") ?? "",
    type: c.req.query("type"),
    status: c.req.query("status"),
    label: c.req.query("label"),
    limit: c.req.query("limit"),
  });
}

searchRoutes.get("/", async (c) => {
  const params = parseQuery(c);
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  const results = await searchIssues(ctx, params.q, {
    type: params.type,
    status: params.status,
    label: params.label,
    limit: params.limit,
  });
  return c.json({ query: params.q, results });
});

searchRoutes.get("/knowledge", async (c) => {
  const params = parseQuery(c);
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  const results = await searchKnowledge(ctx, params.q, {
    type: params.type,
    status: params.status,
    label: params.label,
    limit: params.limit,
  });
  return c.json({ query: params.q, results });
});
