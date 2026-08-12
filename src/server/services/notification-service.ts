/** In-app notification inbox. */
import type { Ctx } from "../ctx";
import { NotFoundError } from "../../domain/errors";
import type { NotificationDto } from "../../shared/contracts/issues";
import * as planningRepo from "../repositories/planning";

export interface DeliverNotificationInput {
  idempotencyKey: string;
  title: string;
  body: string;
  link: string | null;
  kind: string;
}

/**
 * Insert an in-app notification, deduplicated by idempotency key. Returns the
 * notification id (or the existing one when the key was already delivered).
 */
export async function deliverNotification(ctx: Ctx, input: DeliverNotificationInput): Promise<string> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const userEmail = ownerEmail(ctx);

  // Dedupe: look for an existing notification with the same idempotency key.
  const existing = await findByIdempotencyKey(ctx, input.idempotencyKey);
  if (existing) return existing.id;

  await planningRepo.insertNotification(ctx.env.DB, {
    id,
    userEmail,
    title: input.title,
    body: input.body,
    link: input.link,
    kind: input.kind,
    now,
  });

  // Record the idempotency key on a companion row so duplicate deliveries
  // (e.g. duplicate Cron invocations) cannot create duplicates.
  await ctx.env.DB.prepare(
    "INSERT OR IGNORE INTO notification_deliveries (idempotency_key, notification_id, created_at) VALUES (?, ?, ?)",
  )
    .bind(input.idempotencyKey, id, now)
    .run();

  return id;
}

async function findByIdempotencyKey(ctx: Ctx, key: string): Promise<{ id: string } | null> {
  const row = await ctx.env.DB.prepare(
    "SELECT notification_id FROM notification_deliveries WHERE idempotency_key = ?",
  )
    .bind(key)
    .first<{ notification_id: string }>();
  if (!row) return null;
  const notification = await ctx.env.DB.prepare("SELECT id FROM notifications WHERE id = ?").bind(row.notification_id).first<{ id: string }>();
  return notification;
}

export async function listNotifications(ctx: Ctx, limit = 50, unreadOnly = false): Promise<NotificationDto[]> {
  const records = await planningRepo.listNotifications(ctx.env.DB, ownerEmail(ctx), limit, unreadOnly);
  return records.map(toDto);
}

export async function unreadCount(ctx: Ctx): Promise<number> {
  return planningRepo.countUnreadNotifications(ctx.env.DB, ownerEmail(ctx));
}

export async function markRead(ctx: Ctx, notificationId: string): Promise<void> {
  const row = await ctx.env.DB.prepare("SELECT id FROM notifications WHERE id = ?").bind(notificationId).first<{ id: string }>();
  if (!row) throw new NotFoundError("Notification not found");
  await planningRepo.markNotificationRead(ctx.env.DB, notificationId, new Date().toISOString());
}

export async function markAllRead(ctx: Ctx): Promise<void> {
  await planningRepo.markAllNotificationsRead(ctx.env.DB, ownerEmail(ctx), new Date().toISOString());
}

function toDto(r: {
  id: string;
  title: string;
  body: string;
  link: string | null;
  kind: string;
  read_at: string | null;
  created_at: string;
}): NotificationDto {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    link: r.link,
    kind: r.kind,
    read_at: r.read_at,
    created_at: r.created_at,
  };
}

function ownerEmail(ctx: Ctx): string {
  return ctx.env.OWNER_EMAIL || ctx.actor.id || "owner";
}
