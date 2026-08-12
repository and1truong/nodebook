/** Route plumbing: typed Hono app env, JSON error handling, auth middleware. */
import { Hono, type MiddlewareHandler } from "hono";
import { ZodError } from "zod";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Env } from "../../env";
import type { Actor } from "../ctx";
import type { McpIdentity } from "../auth/token-auth";
import { AppError } from "../../domain/errors";
import { authenticateAccess } from "../auth/access-auth";
import { authenticateMcpToken } from "../auth/token-auth";

export interface AppEnv {
  Bindings: Env;
  Variables: {
    actor: Actor;
    mcpIdentity?: McpIdentity;
  };
}

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError((err, c) => {
    if (err instanceof ZodError) {
      const message = err.issues.map((i) => i.message).join("; ");
      return c.json({ error: { code: "validation_error", message } }, 400);
    }
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as ContentfulStatusCode);
    }
    console.error("Unhandled error", err);
    return c.json({ error: { code: "internal_error", message: "Internal error" } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));
  return app;
}

/** Cloudflare Access + owner check for every /api/* request. */
export const accessAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const identity = await authenticateAccess(c.env, c.req.raw);
  c.set("actor", { type: "human", id: identity.email });
  await next();
};

/** Bearer token auth for /mcp; verified identity (with scopes) is stored for the route. */
export const mcpAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) return c.json({ error: { code: "unauthorized", message: "Missing bearer token" } }, 401);
  const identity = await authenticateMcpToken(c.env, token);
  c.set("actor", { type: "mcp", id: identity.tokenId });
  c.set("mcpIdentity", identity);
  await next();
};
