/** Authenticated CRUD routes for saved Issues-page tabs. */
import { Hono } from "hono";
import type { AppEnv } from "./helpers";
import { issueViewCreateSchema, issueViewUpdateSchema } from "../../shared/contracts/issues";
import { ValidationError } from "../../domain/errors";
import * as issueViewService from "../services/issue-view-service";

export const issueViewsRoutes = new Hono<AppEnv>();

function ctx(c: { env: AppEnv["Bindings"]; get: (key: "actor") => AppEnv["Variables"]["actor"] }) {
  return { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
}

issueViewsRoutes.get("/", async (c) => c.json(await issueViewService.listIssueViews(ctx(c))));

issueViewsRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => {
    throw new ValidationError("Invalid JSON body");
  });
  const input = issueViewCreateSchema.parse(body);
  return c.json(await issueViewService.createIssueView(ctx(c), input), 201);
});

issueViewsRoutes.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => {
    throw new ValidationError("Invalid JSON body");
  });
  const input = issueViewUpdateSchema.parse(body);
  return c.json(await issueViewService.updateIssueView(ctx(c), c.req.param("id"), input));
});

issueViewsRoutes.delete("/:id", async (c) => {
  await issueViewService.deleteIssueView(ctx(c), c.req.param("id"));
  return c.body(null, 204);
});
