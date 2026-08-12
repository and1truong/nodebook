/**
 * Reminders: absolute, before-due, and recurring; materialized delivery
 * occurrences with expiring claim locks; in-app notification delivery with
 * idempotency keys.
 */
import type { Ctx } from "../ctx";
import { NotFoundError, ValidationError } from "../../domain/errors";
import type { ReminderOccurrenceRecord, ReminderRecord } from "../../domain/models";
import type { ReminderDto } from "../../shared/contracts/issues";
import { REMINDER_LOCK_MS, REMINDER_MAX_ATTEMPTS } from "../../shared/limits";
import { parseRecurrenceRule, nextOccurrence } from "../../shared/recurrence";
import { isValidTimezone, nowIso, instantFromCivil } from "../../shared/time";
import { recordAudit } from "./audit-service";
import { deliverNotification } from "./notification-service";
import * as planningRepo from "../repositories/planning";
import { getIssueById, getIssueByRef } from "../repositories/issues";

export interface ReminderCreateInput {
  kind: "absolute" | "before_due" | "recurring";
  triggerAt?: string;
  offsetMinutes?: number;
  recurrenceRule?: string;
  timezone?: string;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createReminder(ctx: Ctx, issueRef: string, input: ReminderCreateInput): Promise<ReminderDto> {
  const issue = await getIssueByRef(ctx.env.DB, issueRef);
  if (!issue) throw new NotFoundError(`Issue ${issueRef} not found`);

  const now = nowIso();
  const tz = input.timezone ?? issue.timezone;
  if (!isValidTimezone(tz)) throw new ValidationError(`Invalid timezone: ${tz}`);

  let triggerAt: string | null = null;
  let offsetMinutes: number | null = null;
  let recurrenceRule: string | null = null;

  switch (input.kind) {
    case "absolute": {
      if (!input.triggerAt) throw new ValidationError("trigger_at is required for absolute reminders");
      triggerAt = new Date(input.triggerAt).toISOString();
      break;
    }
    case "before_due": {
      if (!input.offsetMinutes || input.offsetMinutes < 1 || input.offsetMinutes > 43_200) {
        throw new ValidationError("offset_minutes must be between 1 and 43200");
      }
      if (!issue.due_date) throw new ValidationError("Cannot create a before-due reminder: issue has no due date");
      triggerAt = beforeDueTrigger(issue.due_date, input.offsetMinutes, tz);
      offsetMinutes = input.offsetMinutes;
      break;
    }
    case "recurring": {
      if (!input.recurrenceRule) throw new ValidationError("recurrence_rule is required for recurring reminders");
      const rule = parseRecurrenceRule(input.recurrenceRule);
      const next = nextOccurrence(rule, tz, new Date(now));
      if (!next) throw new ValidationError("Recurrence rule produces no future occurrence");
      triggerAt = next.toISOString();
      recurrenceRule = input.recurrenceRule;
      break;
    }
  }

  const reminder: ReminderRecord = {
    id: crypto.randomUUID(),
    issue_id: issue.id,
    kind: input.kind,
    trigger_at: triggerAt,
    offset_minutes: offsetMinutes,
    recurrence_rule: recurrenceRule,
    timezone: tz,
    status: "active",
    snooze_until: null,
    created_by: actorId(ctx),
    created_at: now,
    last_triggered_at: null,
  };

  await planningRepo.insertReminder(ctx.env.DB, {
    id: reminder.id,
    issueId: issue.id,
    kind: reminder.kind,
    triggerAt,
    offsetMinutes,
    recurrenceRule,
    timezone: tz,
    createdBy: reminder.created_by,
    now,
  });

  // Materialize the first delivery occurrence.
  if (triggerAt) {
    await planningRepo.insertReminderOccurrence(ctx.env.DB, {
      id: crypto.randomUUID(),
      reminderId: reminder.id,
      occurrenceAt: triggerAt,
      idempotencyKey: idempotencyKey(reminder.id, triggerAt),
    });
  }

  await recordAudit(ctx, {
    action: "reminder.create",
    entityType: "reminder",
    entityId: reminder.id,
    after: {
      issue_id: issue.id,
      kind: reminder.kind,
      trigger_at: triggerAt,
      offset_minutes: offsetMinutes,
      recurrence_rule: recurrenceRule,
    },
  });

  return toDto(reminder);
}

// ---------------------------------------------------------------------------
// Read / update
// ---------------------------------------------------------------------------

export async function listReminders(ctx: Ctx, issueRef: string): Promise<ReminderDto[]> {
  const issue = await getIssueByRef(ctx.env.DB, issueRef);
  if (!issue) throw new NotFoundError(`Issue ${issueRef} not found`);
  const reminders = await planningRepo.listRemindersForIssue(ctx.env.DB, issue.id);
  return reminders.map(toDto);
}

export async function getReminder(ctx: Ctx, reminderId: string): Promise<ReminderDto> {
  const reminder = await planningRepo.getReminderById(ctx.env.DB, reminderId);
  if (!reminder) throw new NotFoundError("Reminder not found");
  return toDto(reminder);
}

export interface ReminderUpdateInput {
  status?: "active" | "completed" | "dismissed" | "snoozed";
  snooze_until?: string;
  trigger_at?: string;
}

export async function updateReminder(ctx: Ctx, reminderId: string, input: ReminderUpdateInput): Promise<ReminderDto> {
  const reminder = await planningRepo.getReminderById(ctx.env.DB, reminderId);
  if (!reminder) throw new NotFoundError("Reminder not found");
  const before = toDto(reminder);

  const fields: planningRepo.ReminderUpdate = {};

  if (input.status === "snoozed") {
    if (!input.snooze_until) throw new ValidationError("snooze_until is required when snoozing");
    const until = new Date(input.snooze_until).toISOString();
    fields.status = "snoozed";
    fields.snooze_until = until;
    await planningRepo.cancelPendingOccurrences(ctx.env.DB, reminderId);
    await planningRepo.insertReminderOccurrence(ctx.env.DB, {
      id: crypto.randomUUID(),
      reminderId,
      occurrenceAt: until,
      idempotencyKey: idempotencyKey(reminderId, until),
    });
  } else if (input.status) {
    fields.status = input.status;
  }
  if (input.trigger_at) {
    const t = new Date(input.trigger_at).toISOString();
    fields.trigger_at = t;
    fields.status = "active";
    // Rescheduling supersedes the previously materialized occurrence: cancel
    // pending deliveries so only the new trigger can fire.
    await planningRepo.cancelPendingOccurrences(ctx.env.DB, reminderId);
    await planningRepo.insertReminderOccurrence(ctx.env.DB, {
      id: crypto.randomUUID(),
      reminderId,
      occurrenceAt: t,
      idempotencyKey: idempotencyKey(reminderId, t),
    });
  }

  await planningRepo.updateReminder(ctx.env.DB, reminderId, fields);
  await recordAudit(ctx, {
    action: "reminder.update",
    entityType: "reminder",
    entityId: reminderId,
    before,
    after: fields,
  });

  const updated = await planningRepo.getReminderById(ctx.env.DB, reminderId);
  if (!updated) throw new NotFoundError("Reminder not found");
  return toDto(updated);
}

// ---------------------------------------------------------------------------
// Delivery (driven by the one-minute Cron Trigger)
// ---------------------------------------------------------------------------

/**
 * Process due reminders. Idempotent: claim locks expire, delivery uses
 * (reminder, occurrence, channel) idempotency keys, and incomplete attempts
 * are retried on subsequent invocations. Safe under duplicate Cron firings.
 */
export async function processDueReminders(ctx: Ctx, now: Date = new Date()): Promise<{ claimed: number; delivered: number }> {
  const nowIsoStr = now.toISOString();

  // Requeue claims whose lock expired (crashed attempts).
  await planningRepo.requeueExpiredClaims(ctx.env.DB, nowIsoStr);

  let claimed = 0;
  let delivered = 0;
  for (let round = 0; round < 5; round++) {
    const due = await planningRepo.listDueOccurrences(ctx.env.DB, nowIsoStr, 20);
    if (due.length === 0) break;
    for (const occurrence of due) {
      const lockUntil = new Date(now.getTime() + REMINDER_LOCK_MS).toISOString();
      const won = await planningRepo.claimOccurrence(ctx.env.DB, occurrence.id, nowIsoStr, lockUntil);
      if (!won) continue;
      claimed += 1;
      try {
        await deliverOccurrence(ctx, occurrence);
        delivered += 1;
      } catch (e) {
        console.error("reminder delivery failed", occurrence.id, e);
        const fresh = await planningRepo.findOccurrenceByKey(ctx.env.DB, occurrence.idempotency_key);
        if (fresh && fresh.attempt_count >= REMINDER_MAX_ATTEMPTS) {
          await planningRepo.markOccurrenceFailed(ctx.env.DB, occurrence.id);
        }
        // Otherwise the expired lock lets the next Cron tick retry.
      }
    }
  }
  return { claimed, delivered };
}

async function deliverOccurrence(ctx: Ctx, occurrence: ReminderOccurrenceRecord): Promise<void> {
  const reminder = await planningRepo.getReminderById(ctx.env.DB, occurrence.reminder_id);
  if (!reminder) return;
  if (reminder.status !== "active" && reminder.status !== "snoozed") return;

  const issue = await getIssueById(ctx.env.DB, reminder.issue_id);
  const notificationId = await deliverNotification(ctx, {
    idempotencyKey: `${occurrence.idempotency_key}:in_app`,
    title: `Reminder: ${issue?.title ?? "issue"}`,
    body: reminderBody(reminder, occurrence, issue?.number ?? null),
    link: issue ? `/issues/${issue.number}` : null,
    kind: "reminder",
  });

  await planningRepo.markOccurrenceDelivered(ctx.env.DB, occurrence.id, notificationId);
  await planningRepo.updateReminder(ctx.env.DB, reminder.id, {
    last_triggered_at: occurrence.occurrence_at,
  });

  // Advance recurring reminders to their next occurrence.
  if (reminder.kind === "recurring" && reminder.recurrence_rule) {
    const rule = parseRecurrenceRule(reminder.recurrence_rule);
    const next = nextOccurrence(rule, reminder.timezone, new Date(occurrence.occurrence_at));
    if (next) {
      const nextIso = next.toISOString();
      await planningRepo.insertReminderOccurrence(ctx.env.DB, {
        id: crypto.randomUUID(),
        reminderId: reminder.id,
        occurrenceAt: nextIso,
        idempotencyKey: idempotencyKey(reminder.id, nextIso),
      });
    } else {
      await planningRepo.updateReminder(ctx.env.DB, reminder.id, { status: "completed" });
    }
  }
}

// ---------------------------------------------------------------------------
// Recalculation on due-date change
// ---------------------------------------------------------------------------

/** Recalculate before-due reminders whenever an issue's due date changes. */
export async function recalculateBeforeDueRemindersForIssue(
  ctx: Ctx,
  issue: { id: string; due_date: string | null; timezone: string },
): Promise<void> {
  const reminders = await planningRepo.listActiveBeforeDueReminders(ctx.env.DB);
  const affected = reminders.filter((r) => r.issue_id === issue.id);
  for (const reminder of affected) {
    if (!issue.due_date) {
      // No due date anymore: dismiss the reminder (its trigger is meaningless).
      await planningRepo.updateReminder(ctx.env.DB, reminder.id, { status: "dismissed" });
      await planningRepo.cancelPendingOccurrences(ctx.env.DB, reminder.id);
      await recordAudit(ctx, {
        action: "reminder.cancelled_no_due_date",
        entityType: "reminder",
        entityId: reminder.id,
        after: { status: "dismissed" },
      });
      continue;
    }
    const triggerAt = beforeDueTrigger(issue.due_date, reminder.offset_minutes ?? 30, issue.timezone);
    await planningRepo.updateReminder(ctx.env.DB, reminder.id, { trigger_at: triggerAt, status: "active" });
    await planningRepo.cancelPendingOccurrences(ctx.env.DB, reminder.id);
    await planningRepo.insertReminderOccurrence(ctx.env.DB, {
      id: crypto.randomUUID(),
      reminderId: reminder.id,
      occurrenceAt: triggerAt,
      idempotencyKey: idempotencyKey(reminder.id, triggerAt),
    });
    await recordAudit(ctx, {
      action: "reminder.recalculated",
      entityType: "reminder",
      entityId: reminder.id,
      after: { trigger_at: triggerAt },
    });
  }
}

function toIsoOrThrow(value: string, field: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${field} must be an ISO 8601 instant`);
  return d.toISOString();
}

function beforeDueTrigger(dueDate: string, offsetMinutes: number, timezone: string): string {
  const due = parseDueDateEnd(dueDate, timezone);
  return new Date(due.getTime() - offsetMinutes * 60_000).toISOString();
}

function parseDueDateEnd(dueDate: string, timezone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if (!m) throw new ValidationError(`Invalid due date: ${dueDate}`);
  return instantFromCivil(timezone, {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: 23,
    minute: 59,
    second: 59,
  });
}

function idempotencyKey(reminderId: string, occurrenceAt: string): string {
  return `${reminderId}:${occurrenceAt}`;
}

function reminderBody(reminder: ReminderRecord, occurrence: ReminderOccurrenceRecord, issueNumber: number | null): string {
  const at = new Date(occurrence.occurrence_at);
  const base = issueNumber ? `#${issueNumber}` : "issue";
  switch (reminder.kind) {
    case "before_due":
      return `${base} is due soon (reminder ${reminder.offset_minutes} minutes before due).`;
    case "recurring":
      return `${base} recurring reminder fired at ${at.toISOString()}.`;
    default:
      return `${base} reminder fired at ${at.toISOString()}.`;
  }
}

function toDto(r: ReminderRecord): ReminderDto {
  return {
    id: r.id,
    issue_id: r.issue_id,
    kind: r.kind,
    trigger_at: r.trigger_at,
    offset_minutes: r.offset_minutes,
    recurrence_rule: r.recurrence_rule,
    timezone: r.timezone,
    status: r.status,
    snooze_until: r.snooze_until,
    created_at: r.created_at,
    last_triggered_at: r.last_triggered_at,
  };
}

function actorId(ctx: Ctx): string {
  return ctx.actor.type === "human" ? ctx.actor.id : `${ctx.actor.type}:${ctx.actor.id}`;
}
