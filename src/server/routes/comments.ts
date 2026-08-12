/** Comment routes: edit with durable history. */
import { Hono } from "hono";
import type { AppEnv } from "./helpers";
import { updateComment, getComment } from "../services/comment-service";
import { commentUpdateSchema } from "../../shared/contracts/issues";
import { ValidationError } from "../../domain/errors";

export const commentsRoutes = new Hono<AppEnv>();

commentsRoutes.get("/:id", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  return c.json(await getComment(ctx, c.req.param("id")));
});

commentsRoutes.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => {
    throw new ValidationError("Invalid JSON body");
  });
  const input = commentUpdateSchema.parse(body);
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  return c.json(await updateComment(ctx, c.req.param("id"), input.body));
});
