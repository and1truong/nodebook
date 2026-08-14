/** Reminders: creation, claiming, idempotency, locks, recalculation, snooze. */
import { describe, expect, it } from "vitest";
import { api, createIssue, post, patch, testEnv } from "./helpers";
import { systemCtx } from "../../src/server/ctx";
import { processDueReminders } from "../../src/server/services/reminder-service";

function futureIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function process(now?: Date) {
  const ctx = systemCtx(testEnv());
  return processDueReminders(ctx, now);
}

describe("reminders", () => {
  it("creates absolute, before-due, and recurring reminders", async () => {
    const issue = await createIssue({ title: "remind me", due_date: "2030-01-15" });

    const absolute = await post(`/api/reminders/issue/${issue.number}`, {
      kind: "absolute",
      trigger_at: futureIso(60),
    });
    expect(absolute.status).toBe(201);

    const beforeDue = await post(`/api/reminders/issue/${issue.number}`, {
      kind: "before_due",
      offset_minutes: 30,
    });
    expect(beforeDue.status).toBe(201);
    const bd = beforeDue.body as { trigger_at: string; offset_minutes: number };
    expect(bd.offset_minutes).toBe(30);
    // 2030-01-15 23:59 UTC minus 30 min
    expect(bd.trigger_at).toBe("2030-01-15T23:29:59.000Z");

    const recurring = await post(`/api/reminders/issue/${issue.number}`, {
      kind: "recurring",
      recurrence_rule: "FREQ=DAILY;INTERVAL=1",
      timezone: "UTC",
    });
    expect(recurring.status).toBe(201);

    // before_due without a due date fails
    const noDue = await createIssue({ title: "no due" });
    const bad = await post(`/api/reminders/issue/${noDue.number}`, { kind: "before_due", offset_minutes: 30 });
    expect(bad.status).toBe(400);

    const list = await api(`/api/reminders/issue/${issue.number}`);
    expect((list.body as unknown[]).length).toBe(3);
  });

  it("claims due reminders, delivers in-app notifications idempotently", async () => {
    const issue = await createIssue({ title: "notify me" });
    const created = await post(`/api/reminders/issue/${issue.number}`, {
      kind: "absolute",
      trigger_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const reminder = created.body as { id: string };

    const first = await process();
    expect(first.delivered).toBe(1);

    // Duplicate Cron invocation: nothing new is delivered.
    const second = await process();
    expect(second.delivered).toBe(0);

    const notifications = await api("/api/notifications");
    const list = notifications.body as { id: string; title: string; body: string; link: string | null; read_at: string | null }[];
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toContain("notify me");
    expect(list[0]!.link).toBe(`/issues/${issue.number}`);
    expect(list[0]!.read_at).toBeNull();

    const unread = await api("/api/notifications/unread-count");
    expect((unread.body as { count: number }).count).toBe(1);

    // Marking read works
    await post(`/api/notifications/${list[0]!.id}/read`, {});
    const unread2 = await api("/api/notifications/unread-count");
    expect((unread2.body as { count: number }).count).toBe(0);
    void reminder;
  });

  it("recovers from expired claim locks (crashed attempts)", async () => {
    const issue = await createIssue({ title: "lock test" });
    await post(`/api/reminders/issue/${issue.number}`, {
      kind: "absolute",
      trigger_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    });

    const env = testEnv();
    // Simulate a crashed attempt: the occurrence was claimed (lock held) but
    // delivery never completed. The lock is now expired.
    const occ = await env.DB.prepare(
      "SELECT id FROM reminder_occurrences WHERE status = 'due' ORDER BY created_at DESC LIMIT 1",
    ).first<{ id: string }>();
    expect(occ).toBeTruthy();
    await env.DB.prepare(
      "UPDATE reminder_occurrences SET status = 'claimed', claimed_at = ?, claimed_until = ?, attempt_count = 1 WHERE id = ?",
    )
      .bind(
        new Date(Date.now() - 10 * 60_000).toISOString(),
        new Date(Date.now() - 5 * 60_000).toISOString(),
        occ!.id,
      )
      .run();

    // A later Cron tick requeues the expired claim and delivers.
    const retry = await process(new Date());
    expect(retry.delivered).toBe(1);

    const notifications = await api("/api/notifications");
    expect((notifications.body as unknown[]).length).toBe(1);
  });

  it("recalculates before-due reminders when the due date changes", async () => {
    const issue = await createIssue({ title: "reschedule me", due_date: "2030-03-01" });
    await post(`/api/reminders/issue/${issue.number}`, { kind: "before_due", offset_minutes: 60 });

    const res = await patch(`/api/issues/${issue.number}`, {
      expected_version: issue.version,
      due_date: "2030-03-10",
    });
    expect(res.status).toBe(200);

    const reminders = await api(`/api/reminders/issue/${issue.number}`);
    const list = reminders.body as { trigger_at: string }[];
    expect(list).toHaveLength(1);
    expect(list[0]!.trigger_at).toBe("2030-03-10T22:59:59.000Z");
  });

  it("dismisses before-due reminders when the due date is removed", async () => {
    const issue = await createIssue({ title: "cancel me", due_date: "2030-04-01" });
    await post(`/api/reminders/issue/${issue.number}`, { kind: "before_due", offset_minutes: 30 });
    await patch(`/api/issues/${issue.number}`, { expected_version: issue.version, due_date: null });

    const reminders = await api(`/api/reminders/issue/${issue.number}`);
    const list = reminders.body as { status: string }[];
    expect(list[0]!.status).toBe("dismissed");
  });

  it("rescheduling cancels the previously materialized occurrence", async () => {
    const issue = await createIssue({ title: "reschedule me 2" });
    const original = new Date(Date.now() + 30 * 60_000);
    const replacement = new Date(Date.now() + 90 * 60_000);
    const created = await post(`/api/reminders/issue/${issue.number}`, {
      kind: "absolute",
      trigger_at: original.toISOString(),
    });
    const reminder = created.body as { id: string };

    // Reschedule to a later time.
    const rescheduled = await patch(`/api/reminders/${reminder.id}`, {
      trigger_at: replacement.toISOString(),
    });
    expect((rescheduled.body as { trigger_at: string }).trigger_at).toBe(replacement.toISOString());

    // Only the new occurrence is deliverable; the old one was cancelled.
    const env = testEnv();
    const rows = await env.DB.prepare(
      "SELECT occurrence_at, status FROM reminder_occurrences WHERE reminder_id = ? ORDER BY occurrence_at",
    )
      .bind(reminder.id)
      .all<{ occurrence_at: string; status: string }>();
    expect(rows.results).toHaveLength(2);
    const byTime = new Map(rows.results.map((r) => [r.occurrence_at, r.status]));
    expect(byTime.get(original.toISOString())).toBe("cancelled");
    expect(byTime.get(replacement.toISOString())).toBe("due");

    // Processing after the ORIGINAL time delivers nothing…
    await process(new Date(original.getTime() + 60_000));
    const early = await api("/api/notifications");
    expect((early.body as unknown[]).length).toBe(0);

    // …and after the replacement time it delivers exactly once.
    await process(new Date(replacement.getTime() + 60_000));
    const late = await api("/api/notifications");
    expect((late.body as unknown[]).length).toBe(1);
  });

  it("snoozes and dismisses reminders", async () => {
    const issue = await createIssue({ title: "snooze me" });
    await post(`/api/reminders/issue/${issue.number}`, {
      kind: "absolute",
      trigger_at: futureIso(5),
    });
    const reminders = await api(`/api/reminders/issue/${issue.number}`);
    const reminder = (reminders.body as { id: string }[])[0]!;

    const snoozed = await patch(`/api/reminders/${reminder.id}`, {
      status: "snoozed",
      snooze_until: futureIso(120),
    });
    expect((snoozed.body as { status: string }).status).toBe("snoozed");

    const dismissed = await patch(`/api/reminders/${reminder.id}`, { status: "dismissed" });
    expect((dismissed.body as { status: string }).status).toBe("dismissed");

    // Snooze without a time is rejected
    const bad = await patch(`/api/reminders/${reminder.id}`, { status: "snoozed" });
    expect(bad.status).toBe(400);
  });

  it("advances recurring reminders after delivery", async () => {
    const issue = await createIssue({ title: "recurring reminder" });
    await post(`/api/reminders/issue/${issue.number}`, {
      kind: "recurring",
      recurrence_rule: "FREQ=DAILY;INTERVAL=1",
      timezone: "UTC",
    });

    // First occurrence is in the future; force-deliver by processing at a
    // time after the first occurrence (compute trigger from the occurrence row).
    const env = testEnv();
    const occ = await env.DB.prepare(
      "SELECT occurrence_at FROM reminder_occurrences ORDER BY created_at DESC LIMIT 1",
    ).first<{ occurrence_at: string }>();
    const later = new Date(new Date(occ!.occurrence_at).getTime() + 60_000);
    await process(later);

    // Next occurrence materialized.
    const rows = await env.DB.prepare(
      "SELECT occurrence_at FROM reminder_occurrences WHERE status = 'due' ORDER BY occurrence_at",
    ).all<{ occurrence_at: string }>();
    expect(rows.results.length).toBeGreaterThanOrEqual(1);

    const notifications = await api("/api/notifications");
    expect((notifications.body as unknown[]).length).toBe(1);
  });

  it("delivers exactly COUNT occurrences then completes", async () => {
    const issue = await createIssue({ title: "counted reminder" });
    const created = await post(`/api/reminders/issue/${issue.number}`, {
      kind: "recurring",
      recurrence_rule: "FREQ=DAILY;COUNT=2",
      timezone: "UTC",
    });
    const reminderId = (created.body as { id: string }).id;
    const env = testEnv();

    const status = async () =>
      (await env.DB.prepare("SELECT status FROM reminders WHERE id = ?").bind(reminderId).first<{ status: string }>())!.status;
    const occurrenceAt = async (st: string): Promise<string> => {
      const row = await env.DB.prepare(
        "SELECT occurrence_at FROM reminder_occurrences WHERE reminder_id = ? AND status = ? ORDER BY occurrence_at ASC LIMIT 1",
      ).bind(reminderId, st).first<{ occurrence_at: string }>();
      return row!.occurrence_at;
    };

    // Deliver occurrence 1 → the second (final) occurrence is materialized.
    await process(new Date(new Date(await occurrenceAt("due")).getTime() + 60_000));
    expect(await status()).toBe("active");
    expect(await occurrenceAt("due")).toBeTruthy();

    // Deliver occurrence 2 → COUNT=2 is exhausted: reminder completes.
    await process(new Date(new Date(await occurrenceAt("due")).getTime() + 60_000));
    expect(await status()).toBe("completed");

    const occurrences = await env.DB.prepare(
      "SELECT status FROM reminder_occurrences WHERE reminder_id = ?",
    ).bind(reminderId).all<{ status: string }>();
    expect(occurrences.results.map((r) => r.status).sort()).toEqual(["delivered", "delivered"]);
    const notifications = await api("/api/notifications");
    expect((notifications.body as unknown[]).length).toBe(2);
  });

  it("delivers COUNT occurrences then completes", async () => {
    const issue = await createIssue({ title: "count three" });
    const created = await post(`/api/reminders/issue/${issue.number}`, {
      kind: "recurring",
      recurrence_rule: "FREQ=DAILY;COUNT=3",
      timezone: "UTC",
    });
    const reminderId = (created.body as { id: string }).id;
    const env = testEnv();

    const occurrenceAt = async (status: string): Promise<string> => {
      const row = await env.DB.prepare(
        "SELECT occurrence_at FROM reminder_occurrences WHERE reminder_id = ? AND status = ? ORDER BY occurrence_at ASC LIMIT 1",
      ).bind(reminderId, status).first<{ occurrence_at: string }>();
      return row!.occurrence_at;
    };

    // Deliver occurrence 1 → occurrence 2 is materialized.
    await process(new Date(new Date(await occurrenceAt("due")).getTime() + 60_000));
    expect(await occurrenceAt("due")).toBeTruthy();

    // Deliver occurrence 2 → occurrence 3 is materialized.
    await process(new Date(new Date(await occurrenceAt("due")).getTime() + 60_000));
    expect(await occurrenceAt("due")).toBeTruthy();

    // Deliver occurrence 3 → COUNT=3 is exhausted: no fourth delivery.
    await process(new Date(new Date(await occurrenceAt("due")).getTime() + 60_000));
    const reminder = await env.DB.prepare("SELECT status FROM reminders WHERE id = ?").bind(reminderId).first<{ status: string }>();
    expect(reminder!.status).toBe("completed");
    const occurrences = await env.DB.prepare(
      "SELECT status FROM reminder_occurrences WHERE reminder_id = ?",
    ).bind(reminderId).all<{ status: string }>();
    expect(occurrences.results.map((r) => r.status).sort()).toEqual(["delivered", "delivered", "delivered"]);
    const notifications = await api("/api/notifications");
    expect((notifications.body as unknown[]).length).toBe(3);
  });
});
