/** Route plumbing: typed Hono app env, JSON error handling, auth middleware. */
import { Hono, type MiddlewareHandler } from "hono";
import { ZodError } from "zod";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Env } from "../../env";
import { oauthIssuer } from "../../env";
import type { Actor } from "../ctx";
import type { McpIdentity } from "../auth/token-auth";
import { AppError, AuthError } from "../../domain/errors";
import { authenticateAccess } from "../auth/access-auth";
import { authenticateMcpToken } from "../auth/token-auth";
import { authenticateOauthAccessToken } from "../auth/oauth-token-auth";

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
      return c.json(
        { error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } },
        err.status as ContentfulStatusCode,
      );
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

/**
 * Bearer token auth for /mcp. Accepts personal access tokens (`nbk_…`) and
 * OAuth access tokens (`nbo_…`, resolved to their owning grant); verified
 * identity (with scopes) is stored for the route. Credentials are revalidated
 * against D1 on every request.
 *
 * Failures return 401 with a standards-compliant challenge that advertises
 * the OAuth protected-resource metadata URL, so OAuth-capable MCP clients
 * (e.g. ChatGPT) can discover the authorization server.
 */
export const mcpAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  // CORS preflights carry no Authorization header; let the /mcp OPTIONS
  // handler (worker.ts app.all("/mcp", ...)) answer with the CORS headers.
  if (c.req.method === "OPTIONS") return next();
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  const resourceMetadata = `${oauthIssuer(c.env, c.req.raw)}/.well-known/oauth-protected-resource/mcp`;
  if (!token) {
    return c.json({ error: { code: "unauthorized", message: "Missing bearer token" } }, 401, {
      "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadata}"`,
    });
  }
  let identity: McpIdentity;
  try {
    identity = token.startsWith("nbk_")
      ? await authenticateMcpToken(c.env, token)
      : await authenticateOauthAccessToken(c.env, token, c.req.raw);
  } catch (e) {
    if (e instanceof AuthError) {
      return c.json({ error: { code: "unauthorized", message: e.message } }, 401, {
        "WWW-Authenticate": `Bearer error="invalid_token", resource_metadata="${resourceMetadata}"`,
      });
    }
    throw e;
  }
  c.set("actor", { type: "mcp", id: identity.tokenId });
  c.set("mcpIdentity", identity);
  await next();
};
