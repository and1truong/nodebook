/** Notification inbox routes. */
import { Hono } from "hono";
import type { AppEnv } from "./helpers";
import * as notificationService from "../services/notification-service";

export const notificationsRoutes = new Hono<AppEnv>();

notificationsRoutes.get("/", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const unreadOnly = c.req.query("unread") === "1";
  return c.json(await notificationService.listNotifications(ctx, limit, unreadOnly));
});

notificationsRoutes.get("/unread-count", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  return c.json({ count: await notificationService.unreadCount(ctx) });
});

notificationsRoutes.post("/:id/read", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  await notificationService.markRead(ctx, c.req.param("id"));
  return c.json({ ok: true });
});

notificationsRoutes.post("/read-all", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  await notificationService.markAllRead(ctx);
  return c.json({ ok: true });
});
