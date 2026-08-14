/** D1 data access for planning: occurrences, reminders, notifications. */
import type { D1Database } from "@cloudflare/workers-types";
import type { NotificationRecord, OccurrenceRecord, ReminderOccurrenceRecord, ReminderRecord } from "../../domain/models";

// ---------------------------------------------------------------------------
// Recurring-task completion occurrences
// ---------------------------------------------------------------------------

export async function insertOccurrence(db: D1Database, input: { id: string; issueId: string; occurredOn: string }): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO occurrences (id, issue_id, occurred_on, created_at) VALUES (?, ?, ?, ?)")
    .bind(input.id, input.issueId, input.occurredOn, new Date().toISOString())
    .run();
}

export async function listOccurrences(db: D1Database, issueId: string): Promise<OccurrenceRecord[]> {
  const res = await db
    .prepare("SELECT * FROM occurrences WHERE issue_id = ? ORDER BY occurred_on ASC")
    .bind(issueId)
    .all<Record<string, unknown>>();
  return res.results.map((row) => ({
    id: String(row.id),
    issue_id: String(row.issue_id),
    occurred_on: String(row.occurred_on),
    created_at: String(row.created_at),
  }));
}

export async function lastOccurrence(db: D1Database, issueId: string): Promise<OccurrenceRecord | null> {
  const row = await db
    .prepare("SELECT * FROM occurrences WHERE issue_id = ? ORDER BY occurred_on DESC LIMIT 1")
    .bind(issueId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: String(row.id),
    issue_id: String(row.issue_id),
    occurred_on: String(row.occurred_on),
    created_at: String(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export interface ReminderInsert {
  id: string;
  issueId: string;
  kind: string;
  triggerAt: string | null;
  offsetMinutes: number | null;
  recurrenceRule: string | null;
  timezone: string;
  createdBy: string;
  createdFor: string | null;
  createdVia: "web" | "mcp" | "system";
  now: string;
}

export async function insertReminder(db: D1Database, input: ReminderInsert): Promise<void> {
  await db
    .prepare(
      `INSERT INTO reminders (id, issue_id, kind, trigger_at, offset_minutes, recurrence_rule, timezone,
        status, snooze_until, created_by, created_for, created_via, created_at, last_triggered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?, ?, NULL)`,
    )
    .bind(
      input.id,
      input.issueId,
      input.kind,
      input.triggerAt,
      input.offsetMinutes,
      input.recurrenceRule,
      input.timezone,
      input.createdBy,
      input.createdFor,
      input.createdVia,
      input.now,
    )
    .run();
}

export async function getReminderById(db: D1Database, id: string): Promise<ReminderRecord | null> {
  const row = await db.prepare("SELECT * FROM reminders WHERE id = ?").bind(id).first<Record<string, unknown>>();
  return row ? rowToReminder(row) : null;
}

export async function listRemindersForIssue(db: D1Database, issueId: string): Promise<ReminderRecord[]> {
  const res = await db
    .prepare("SELECT * FROM reminders WHERE issue_id = ? ORDER BY created_at ASC, id ASC")
    .bind(issueId)
    .all<Record<string, unknown>>();
  return res.results.map(rowToReminder);
}

export async function listActiveReminders(db: D1Database): Promise<ReminderRecord[]> {
  const res = await db
    .prepare("SELECT * FROM reminders WHERE status = 'active' ORDER BY created_at ASC")
    .all<Record<string, unknown>>();
  return res.results.map(rowToReminder);
}

export async function listActiveBeforeDueReminders(db: D1Database): Promise<ReminderRecord[]> {
  const res = await db
    .prepare("SELECT * FROM reminders WHERE status = 'active' AND kind = 'before_due'")
    .all<Record<string, unknown>>();
  return res.results.map(rowToReminder);
}

export type ReminderUpdate = Partial<
  Pick<ReminderRecord, "trigger_at" | "status" | "snooze_until" | "last_triggered_at">
>;

export async function updateReminder(
  db: D1Database,
  id: string,
  fields: ReminderUpdate,
): Promise<ReminderRecord | null> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return null;
  const sets = entries.map(([key]) => `${key} = ?`);
  const args = entries.map(([, v]) => (v === null ? null : String(v)));
  const row = await db
    .prepare(`UPDATE reminders SET ${sets.join(", ")} WHERE id = ? RETURNING *`)
    .bind(...args, id)
    .first<Record<string, unknown>>();
  return row ? rowToReminder(row) : null;
}

function rowToReminder(row: Record<string, unknown>): ReminderRecord {
  return {
    id: String(row.id),
    issue_id: String(row.issue_id),
    kind: row.kind as ReminderRecord["kind"],
    trigger_at: (row.trigger_at as string | null) ?? null,
    offset_minutes: (row.offset_minutes as number | null) ?? null,
    recurrence_rule: (row.recurrence_rule as string | null) ?? null,
    timezone: String(row.timezone),
    status: row.status as ReminderRecord["status"],
    snooze_until: (row.snooze_until as string | null) ?? null,
    created_by: String(row.created_by),
    created_for: (row.created_for as string | null) ?? null,
    created_via: (row.created_via as ReminderRecord["created_via"]) ?? null,
    created_at: String(row.created_at),
    last_triggered_at: (row.last_triggered_at as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Reminder occurrences
// ---------------------------------------------------------------------------

export async function insertReminderOccurrence(db: D1Database, input: { id: string; reminderId: string; occurrenceAt: string; idempotencyKey: string }): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO reminder_occurrences (id, reminder_id, occurrence_at, status, idempotency_key, created_at)
       VALUES (?, ?, ?, 'due', ?, ?)`,
    )
    .bind(input.id, input.reminderId, input.occurrenceAt, input.idempotencyKey, new Date().toISOString())
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Atomically claim a due occurrence; returns true when this caller won the lock. */
export async function claimOccurrence(db: D1Database, id: string, now: string, lockUntil: string): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE reminder_occurrences SET status = 'claimed', claimed_at = ?, claimed_until = ?, attempt_count = attempt_count + 1
       WHERE id = ? AND status = 'due' AND occurrence_at <= ?`,
    )
    .bind(now, lockUntil, id, now)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Requeue occurrences whose claim lock has expired. */
export async function requeueExpiredClaims(db: D1Database, now: string): Promise<number> {
  const res = await db
    .prepare(
      `UPDATE reminder_occurrences SET status = 'due', claimed_at = NULL, claimed_until = NULL
       WHERE status = 'claimed' AND claimed_until IS NOT NULL AND claimed_until < ? AND attempt_count < ?`,
    )
    .bind(now, 3)
    .run();
  return res.meta.changes ?? 0;
}

export async function markOccurrenceDelivered(db: D1Database, id: string, notificationId: string | null): Promise<void> {
  await db
    .prepare("UPDATE reminder_occurrences SET status = 'delivered', notification_id = ? WHERE id = ? AND status = 'claimed'")
    .bind(notificationId, id)
    .run();
}

export async function markOccurrenceFailed(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("UPDATE reminder_occurrences SET status = 'failed' WHERE id = ? AND status = 'claimed'")
    .bind(id)
    .run();
}

export async function cancelPendingOccurrences(db: D1Database, reminderId: string): Promise<void> {
  await db
    .prepare("UPDATE reminder_occurrences SET status = 'cancelled' WHERE reminder_id = ? AND status = 'due'")
    .bind(reminderId)
    .run();
}

export async function listDueOccurrences(db: D1Database, now: string, limit: number): Promise<ReminderOccurrenceRecord[]> {
  const res = await db
    .prepare(
      "SELECT * FROM reminder_occurrences WHERE status = 'due' AND occurrence_at <= ? ORDER BY occurrence_at ASC LIMIT ?",
    )
    .bind(now, limit)
    .all<Record<string, unknown>>();
  return res.results.map(rowToOccurrence);
}

export async function findOccurrenceByKey(db: D1Database, idempotencyKey: string): Promise<ReminderOccurrenceRecord | null> {
  const row = await db.prepare("SELECT * FROM reminder_occurrences WHERE idempotency_key = ?").bind(idempotencyKey).first<Record<string, unknown>>();
  return row ? rowToOccurrence(row) : null;
}

export async function listOccurrencesForReminder(db: D1Database, reminderId: string): Promise<ReminderOccurrenceRecord[]> {
  const res = await db
    .prepare("SELECT * FROM reminder_occurrences WHERE reminder_id = ? ORDER BY occurrence_at ASC")
    .bind(reminderId)
    .all<Record<string, unknown>>();
  return res.results.map(rowToOccurrence);
}

/**
 * Number of deliveries already completed for a reminder. Recurring reminders
 * derive their series ordinal from this so COUNT-terminated rules close once
 * the materialized deliveries are exhausted (mirrors recurring-task
 * completion, which counts the `occurrences` table).
 */
export async function countDeliveredOccurrences(db: D1Database, reminderId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM reminder_occurrences WHERE reminder_id = ? AND status = 'delivered'")
    .bind(reminderId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

function rowToOccurrence(row: Record<string, unknown>): ReminderOccurrenceRecord {
  return {
    id: String(row.id),
    reminder_id: String(row.reminder_id),
    occurrence_at: String(row.occurrence_at),
    status: row.status as ReminderOccurrenceRecord["status"],
    claimed_at: (row.claimed_at as string | null) ?? null,
    claimed_until: (row.claimed_until as string | null) ?? null,
    attempt_count: Number(row.attempt_count ?? 0),
    notification_id: (row.notification_id as string | null) ?? null,
    idempotency_key: String(row.idempotency_key),
    created_at: String(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// Notifications (in-app inbox)
// ---------------------------------------------------------------------------

export async function insertNotification(
  db: D1Database,
  input: { id: string; userEmail: string; title: string; body: string; link: string | null; kind: string; now: string },
): Promise<void> {
  await db
    .prepare("INSERT INTO notifications (id, user_email, title, body, link, kind, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)")
    .bind(input.id, input.userEmail, input.title, input.body, input.link, input.kind, input.now)
    .run();
}

export async function listNotifications(db: D1Database, userEmail: string, limit: number, unreadOnly: boolean): Promise<NotificationRecord[]> {
  const where = unreadOnly ? "user_email = ? AND read_at IS NULL" : "user_email = ?";
  const res = await db
    .prepare(`SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(userEmail, limit)
    .all<Record<string, unknown>>();
  return res.results.map(rowToNotification);
}

export async function countUnreadNotifications(db: D1Database, userEmail: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_email = ? AND read_at IS NULL")
    .bind(userEmail)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function markNotificationRead(db: D1Database, id: string, now: string): Promise<void> {
  await db.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL").bind(now, id).run();
}

export async function markAllNotificationsRead(db: D1Database, userEmail: string, now: string): Promise<void> {
  await db.prepare("UPDATE notifications SET read_at = ? WHERE user_email = ? AND read_at IS NULL").bind(now, userEmail).run();
}

function rowToNotification(row: Record<string, unknown>): NotificationRecord {
  return {
    id: String(row.id),
    user_email: String(row.user_email),
    title: String(row.title),
    body: String(row.body),
    link: (row.link as string | null) ?? null,
    kind: String(row.kind),
    read_at: (row.read_at as string | null) ?? null,
    created_at: String(row.created_at),
  };
}
