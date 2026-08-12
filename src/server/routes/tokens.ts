/** MCP token management routes (web UI). */
import { Hono } from "hono";
import type { AppEnv } from "./helpers";
import * as tokenService from "../services/token-service";
import { tokenCreateSchema } from "../../shared/contracts/issues";
import { ValidationError } from "../../domain/errors";

export const tokensRoutes = new Hono<AppEnv>();

tokensRoutes.get("/", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  return c.json(await tokenService.listTokens(ctx));
});

tokensRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => {
    throw new ValidationError("Invalid JSON body");
  });
  const input = tokenCreateSchema.parse(body);
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  const token = await tokenService.createToken(ctx, {
    name: input.name,
    scopes: [...input.scopes],
    expiresInDays: input.expires_in_days ?? null,
  });
  return c.json(token, 201);
});

tokensRoutes.post("/:id/revoke", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  const token = await tokenService.revokeToken(ctx, c.req.param("id"));
  return c.json(token);
});
