/** Planning routes: Inbox, Today, Calendar, Overdue (Upcoming kept for API/MCP compatibility). */
import { Hono } from "hono";
import type { AppEnv } from "./helpers";
import { getInbox, getToday, getUpcoming, getOverdue, getCalendar } from "../services/planning-service";

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

planningRoutes.get("/calendar", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  return c.json(await getCalendar(ctx, c.req.query("start"), c.req.query("end"), c.req.query("tz")));
});

planningRoutes.get("/overdue", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  return c.json(await getOverdue(ctx, c.req.query("tz")));
});
