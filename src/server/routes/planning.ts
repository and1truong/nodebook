/** Planning routes: Inbox, Today, Upcoming, Overdue. */
import { Hono } from "hono";
import type { AppEnv } from "./helpers";
import { getInbox, getToday, getUpcoming, getOverdue } from "../services/planning-service";

export const planningRoutes = new Hono<AppEnv>();

planningRoutes.get("/inbox", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  return c.json(await getInbox(ctx));
});

planningRoutes.get("/today", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  return c.json(await getToday(ctx, c.req.query("tz")));
});

planningRoutes.get("/upcoming", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  return c.json(await getUpcoming(ctx, c.req.query("tz")));
});

planningRoutes.get("/overdue", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  return c.json(await getOverdue(ctx, c.req.query("tz")));
});
