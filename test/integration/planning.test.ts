/** Planning views and recurring-task behavior. */
import { describe, expect, it } from "vitest";
import { api, createIssue, post, patch, testEnv } from "./helpers";

function todayCivil(now = new Date()): string {
  const d = now;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe("planning views", () => {
  it("defines Inbox as open items without planning dates", async () => {
    const inboxItem = await createIssue({ title: "inbox item" });
    const scheduled = await createIssue({ title: "not inbox", due_date: addDays(todayCivil(), 3) });
    void scheduled;

    const res = await api("/api/planning/inbox");
    const items = res.body as { issue: { number: number } }[];
    expect(items.some((i) => i.issue.number === inboxItem.number)).toBe(true);
    expect(items.some((i) => i.issue.number === scheduled.number)).toBe(false);
  });

  it("computes Today from the owner's local day plus overdue", async () => {
    const today = todayCivil();
    const dueToday = await createIssue({ title: "due today", due_date: today });
    const dueTomorrow = await createIssue({ title: "tomorrow", due_date: addDays(today, 1) });
    const overdue = await createIssue({ title: "overdue", due_date: addDays(today, -2) });
    const closedOverdue = await createIssue({ title: "closed overdue", due_date: addDays(today, -5) });
    await post(`/api/issues/${closedOverdue.number}/close`, {});

    const res = await api("/api/planning/today?tz=UTC");
    const items = res.body as { issue: { number: number }; matched_kind: string }[];
    const numbers = items.map((i) => i.issue.number);
    expect(numbers).toContain(dueToday.number);
    expect(numbers).toContain(overdue.number);
    expect(numbers).not.toContain(dueTomorrow.number);
    expect(numbers).not.toContain(closedOverdue.number);

    const overdueItem = items.find((i) => i.issue.number === overdue.number)!;
    expect(overdueItem.matched_kind).toBe("overdue");
  });

  it("orders overdue work before due-today work", async () => {
    const today = todayCivil();
    const overdue = await createIssue({ title: "order overdue", due_date: addDays(today, -1) });
    const due = await createIssue({ title: "order due", due_date: today });

    const res = await api("/api/planning/today?tz=UTC");
    const items = res.body as { issue: { number: number }; matched_kind: string }[];
    const overdueIdx = items.findIndex((i) => i.issue.number === overdue.number);
    const dueIdx = items.findIndex((i) => i.issue.number === due.number);
    expect(overdueIdx).toBeGreaterThanOrEqual(0);
    expect(dueIdx).toBeGreaterThan(overdueIdx);
  });

  it("computes Upcoming as future scheduled/due work", async () => {
    const today = todayCivil();
    const future = await createIssue({ title: "future", scheduled_date: new Date(Date.now() + 2 * 86_400_000).toISOString() });
    const pastScheduled = await createIssue({ title: "past scheduled", scheduled_date: new Date(Date.now() - 86_400_000).toISOString() });

    const res = await api("/api/planning/upcoming?tz=UTC");
    const items = res.body as { issue: { number: number } }[];
    const numbers = items.map((i) => i.issue.number);
    expect(numbers).toContain(future.number);
    expect(numbers).not.toContain(pastScheduled.number);
    void today;
  });

  it("excludes later-today scheduled work from Upcoming (it belongs to Today)", async () => {
    // 23:59:59 UTC today: later today by civil date in any case (even when
    // the instant is already past, Today still matches by civil date and
    // Upcoming must not include it).
    const nowUtc = new Date();
    const laterToday = new Date(
      Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate(), 23, 59, 59),
    );
    // Tomorrow 00:00 UTC is strictly after today's civil date.
    const tomorrow = new Date(
      Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate() + 1, 0, 0, 0),
    );
    const laterTodayIssue = await createIssue({ title: "later today", scheduled_date: laterToday.toISOString() });
    const tomorrowIssue = await createIssue({ title: "tomorrow", scheduled_date: tomorrow.toISOString() });

    const upcoming = await api("/api/planning/upcoming?tz=UTC");
    const upcomingNumbers = (upcoming.body as { issue: { number: number } }[]).map((i) => i.issue.number);
    expect(upcomingNumbers).toContain(tomorrowIssue.number);
    expect(upcomingNumbers).not.toContain(laterTodayIssue.number);

    const todayRes = await api("/api/planning/today?tz=UTC");
    const todayNumbers = (todayRes.body as { issue: { number: number } }[]).map((i) => i.issue.number);
    expect(todayNumbers).toContain(laterTodayIssue.number);
  });

  it("computes Overdue as open work past due", async () => {
    const today = todayCivil();
    const overdue = await createIssue({ title: "overdue only", due_date: addDays(today, -1) });
    const notOverdue = await createIssue({ title: "not overdue", due_date: today });

    const res = await api("/api/planning/overdue?tz=UTC");
    const items = res.body as { issue: { number: number } }[];
    const numbers = items.map((i) => i.issue.number);
    expect(numbers).toContain(overdue.number);
    expect(numbers).not.toContain(notOverdue.number);
  });
});

describe("calendar range API", () => {
  it("includes the start date and excludes the end date (due dates)", async () => {
    const onStart = await createIssue({ title: "due on start", due_date: "2025-06-01" });
    const inside = await createIssue({ title: "due inside", due_date: "2025-06-15" });
    const onEnd = await createIssue({ title: "due on end", due_date: "2025-07-01" });

    const res = await api("/api/planning/calendar?start=2025-06-01&end=2025-07-01&tz=UTC");
    expect(res.status).toBe(200);
    const items = res.body as { issue: { number: number }; date: string; kind: string }[];
    const numbers = items.map((i) => i.issue.number);
    expect(numbers).toContain(onStart.number);
    expect(numbers).toContain(inside.number);
    expect(numbers).not.toContain(onEnd.number);

    const startEntry = items.find((i) => i.issue.number === onStart.number)!;
    expect(startEntry.date).toBe("2025-06-01");
    expect(startEntry.kind).toBe("due");
  });

  it("converts scheduled instants to viewer-local dates across midnight", async () => {
    // 02:30Z on Mar 9 is 21:30 EST on Mar 8 in America/New_York.
    const issue = await createIssue({
      title: "crossing midnight",
      scheduled_date: "2025-03-09T02:30:00.000Z",
    });

    const inRange = await api("/api/planning/calendar?start=2025-03-08&end=2025-03-09&tz=America/New_York");
    expect(inRange.status).toBe(200);
    const inItems = inRange.body as { issue: { number: number }; date: string; kind: string }[];
    const inEntry = inItems.find((i) => i.issue.number === issue.number);
    expect(inEntry).toBeTruthy();
    expect(inEntry!.date).toBe("2025-03-08");
    expect(inEntry!.kind).toBe("scheduled");

    const nextRange = await api("/api/planning/calendar?start=2025-03-09&end=2025-03-10&tz=America/New_York");
    const nextItems = nextRange.body as { issue: { number: number } }[];
    expect(nextItems.some((i) => i.issue.number === issue.number)).toBe(false);
  });

  it("bounds scheduled instants by timezone-derived day instants (DST)", async () => {
    // America/New_York springs forward 2025-03-09: the civil day [Mar 9,
    // Mar 10) spans [05:00Z, 04:00Z next day). 04:59:59Z is still Mar 8
    // 23:59 EST; 05:00:00Z is exactly Mar 9 00:00 EDT.
    const before = await createIssue({ title: "dst before", scheduled_date: "2025-03-09T04:59:59.000Z" });
    const at = await createIssue({ title: "dst at", scheduled_date: "2025-03-09T05:00:00.000Z" });

    const res = await api("/api/planning/calendar?start=2025-03-09&end=2025-03-10&tz=America/New_York");
    expect(res.status).toBe(200);
    const items = res.body as { issue: { number: number }; date: string }[];
    const numbers = items.map((i) => i.issue.number);
    expect(numbers).not.toContain(before.number);
    expect(numbers).toContain(at.number);
    const atEntry = items.find((i) => i.issue.number === at.number)!;
    expect(atEntry.date).toBe("2025-03-09");

    // The instant boundary is inclusive at start, exclusive at end: the same
    // instant at the previous day's end is excluded from the prior day.
    const prior = await api("/api/planning/calendar?start=2025-03-08&end=2025-03-09&tz=America/New_York");
    const priorItems = prior.body as { issue: { number: number } }[];
    expect(priorItems.some((i) => i.issue.number === at.number)).toBe(false);
    expect(priorItems.some((i) => i.issue.number === before.number)).toBe(true);
  });

  it("expands an issue with both due and scheduled values into two entries", async () => {
    const issue = await createIssue({
      title: "dual planning",
      due_date: "2025-06-10",
      scheduled_date: "2025-06-10T09:00:00.000Z",
    });

    const res = await api("/api/planning/calendar?start=2025-06-10&end=2025-06-11&tz=UTC");
    expect(res.status).toBe(200);
    const items = res.body as { issue: { number: number }; date: string; kind: string }[];
    const entries = items.filter((i) => i.issue.number === issue.number);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.kind).sort()).toEqual(["due", "scheduled"]);
    expect(entries.every((e) => e.date === "2025-06-10")).toBe(true);
  });

  it("excludes closed, dateless, and start_date-only issues", async () => {
    const closed = await createIssue({ title: "closed in range", due_date: "2025-06-10" });
    await post(`/api/issues/${closed.number}/close`, {});
    const dateless = await createIssue({ title: "no dates" });
    const startOnly = await createIssue({ title: "start only", start_date: "2025-06-10" });

    const res = await api("/api/planning/calendar?start=2025-06-01&end=2025-07-01&tz=UTC");
    expect(res.status).toBe(200);
    const numbers = (res.body as { issue: { number: number } }[]).map((i) => i.issue.number);
    expect(numbers).not.toContain(closed.number);
    expect(numbers).not.toContain(dateless.number);
    expect(numbers).not.toContain(startOnly.number);
  });

  it("orders entries by date, then kind, then issue number", async () => {
    const laterDue = await createIssue({ title: "later due", due_date: "2025-06-12" });
    const earlierDue = await createIssue({ title: "earlier due", due_date: "2025-06-01" });
    const dual = await createIssue({
      title: "dual on same day",
      due_date: "2025-06-01",
      scheduled_date: "2025-06-01T08:00:00.000Z",
    });
    const sameDayScheduled = await createIssue({
      title: "same day scheduled",
      scheduled_date: "2025-06-01T10:00:00.000Z",
    });

    const res = await api("/api/planning/calendar?start=2025-06-01&end=2025-06-30&tz=UTC");
    expect(res.status).toBe(200);
    const items = res.body as { issue: { number: number }; date: string; kind: string }[];
    const keys = items.map((i) => `${i.date}:${i.kind}:${i.issue.number}`);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);

    // Deterministic placement: dues sort before scheduled on the same date,
    // and earlier issue numbers first among equal keys.
    expect(keys.indexOf("2025-06-01:due:" + earlierDue.number)).toBeLessThan(
      keys.indexOf("2025-06-01:scheduled:" + sameDayScheduled.number),
    );
    expect(keys.indexOf("2025-06-01:due:" + earlierDue.number)).toBeLessThan(
      keys.indexOf("2025-06-01:due:" + dual.number),
    );
    expect(keys.indexOf("2025-06-01:due:" + dual.number)).toBeLessThan(
      keys.indexOf("2025-06-12:due:" + laterDue.number),
    );
  });

  it("returns an empty range as an empty list", async () => {
    const res = await api("/api/planning/calendar?start=2030-01-01&end=2030-01-02&tz=UTC");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("rejects missing, malformed, inverted, and unbounded ranges", async () => {
    const missing = await api("/api/planning/calendar?tz=UTC");
    expect(missing.status).toBe(400);

    const malformed = await api("/api/planning/calendar?start=2025-06-1&end=2025-07-01&tz=UTC");
    expect(malformed.status).toBe(400);

    const inverted = await api("/api/planning/calendar?start=2025-07-01&end=2025-06-01&tz=UTC");
    expect(inverted.status).toBe(400);

    const same = await api("/api/planning/calendar?start=2025-06-01&end=2025-06-01&tz=UTC");
    expect(same.status).toBe(400);

    // Beyond a six-week month grid (42 days) plus slack.
    const tooLarge = await api("/api/planning/calendar?start=2025-01-01&end=2025-04-01&tz=UTC");
    expect(tooLarge.status).toBe(400);
  });

  it("keeps the Upcoming API intact alongside the calendar endpoint", async () => {
    const today = todayCivil();
    const future = await createIssue({ title: "future for upcoming", due_date: addDays(today, 5) });
    const res = await api("/api/planning/upcoming?tz=UTC");
    expect(res.status).toBe(200);
    const numbers = (res.body as { issue: { number: number } }[]).map((i) => i.issue.number);
    expect(numbers).toContain(future.number);
  });

  it("recalculates before-due reminders when a calendar move changes the due date", async () => {
    // A calendar drag persists via the same PATCH the calendar client sends;
    // before-due reminders must track the new due date server-side.
    const issue = await createIssue({ title: "reminder follows move", due_date: "2025-06-10" });
    const created = await post(`/api/reminders/issue/${issue.number}`, {
      kind: "before_due",
      offset_minutes: 60,
    });
    expect(created.status).toBe(201);
    const first = created.body as { trigger_at: string };
    // Before-due reminders anchor to the due day's end (23:59:59) minus the offset.
    expect(first.trigger_at).toBe("2025-06-10T22:59:59.000Z");

    const moved = await patch(`/api/issues/${issue.number}`, {
      expected_version: issue.version,
      due_date: "2025-06-20",
    });
    expect(moved.status).toBe(200);

    const list = await api(`/api/reminders/issue/${issue.number}`);
    const reminders = list.body as { trigger_at: string; kind: string }[];
    const beforeDue = reminders.find((r) => r.kind === "before_due")!;
    expect(beforeDue.trigger_at).toBe("2025-06-20T22:59:59.000Z");
  });
});

describe("recurring tasks", () => {
  it("advances planning dates and records occurrences on completion", async () => {
    const today = todayCivil();
    const issue = await createIssue({
      title: "daily standup",
      type: "task",
      recurrence_rule: "FREQ=DAILY;INTERVAL=1",
      due_date: today,
      timezone: "UTC",
    });

    const res = await post(`/api/issues/${issue.number}/complete`, {});
    expect(res.status).toBe(200);
    const updated = res.body as { status: string; due_date: string; completed_at: string | null };
    expect(updated.status).toBe("open");
    expect(updated.due_date).toBe(addDays(today, 1));

    // Occurrence recorded
    const rows = await testEnv().DB.prepare("SELECT occurred_on FROM occurrences WHERE issue_id = ?")
      .bind(issue.id)
      .all<{ occurred_on: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]!.occurred_on).toBeTruthy();
  });

  it("advances a dateless recurring task into planning (scheduled_date)", async () => {
    const issue = await createIssue({
      title: "dateless daily",
      type: "task",
      recurrence_rule: "FREQ=DAILY;INTERVAL=1",
      timezone: "UTC",
    });
    expect(issue.start_date).toBeNull();
    expect(issue.due_date).toBeNull();
    expect(issue.scheduled_date).toBeNull();

    const res = await post(`/api/issues/${issue.number}/complete`, {});
    const updated = res.body as { status: string; scheduled_date: string | null };
    expect(updated.status).toBe("open");
    expect(updated.scheduled_date).not.toBeNull(); // rolls forward into planning

    // It now appears in Upcoming/Today on its cycle day rather than staying
    // forever in Inbox.
    const inbox = await api("/api/planning/inbox");
    expect((inbox.body as { issue: { number: number } }[]).some((i) => i.issue.number === issue.number)).toBe(false);
  });

  it("keeps start_date aligned with the advanced due date (no start > due)", async () => {
    // Complete long after the due date: start must not be set to "today".
    const issue = await createIssue({
      title: "late completion",
      type: "task",
      recurrence_rule: "FREQ=DAILY;INTERVAL=1",
      start_date: "2020-01-01",
      due_date: "2020-01-02",
      timezone: "UTC",
    });
    const res = await post(`/api/issues/${issue.number}/complete`, {});
    const updated = res.body as { start_date: string; due_date: string };
    expect(updated.start_date).toBe(updated.due_date);
    expect(updated.start_date).toBe("2020-01-03");
  });

  it("closes non-recurring tasks on completion", async () => {
    const issue = await createIssue({ title: "one-off task" });
    const res = await post(`/api/issues/${issue.number}/complete`, {});
    expect(res.status).toBe(200);
    const updated = res.body as { status: string; closed_at: string | null; completed_at: string | null };
    expect(updated.status).toBe("closed");
    expect(updated.completed_at).toBeTruthy();
  });

  it("respects COUNT termination for recurring tasks", async () => {
    const today = todayCivil();
    const issue = await createIssue({
      title: "three times",
      recurrence_rule: "FREQ=DAILY;INTERVAL=1;COUNT=2",
      due_date: today,
      timezone: "UTC",
    });

    const first = await post(`/api/issues/${issue.number}/complete`, {});
    expect((first.body as { status: string }).status).toBe("open"); // occurrence 2
    const second = await post(`/api/issues/${issue.number}/complete`, {});
    expect((second.body as { status: string }).status).toBe("closed"); // series exhausted
    const third = await post(`/api/issues/${issue.number}/complete`, {});
    expect(third.status).toBe(409); // already closed
  });

  it("handles DST transitions when advancing (America/New_York)", async () => {
    // March 8 2025 (EST) → next occurrence must still be 09:00 wall clock on March 9.
    const issue = await createIssue({
      title: "dst daily",
      recurrence_rule: "FREQ=DAILY;INTERVAL=1",
      due_date: "2025-03-08",
      timezone: "America/New_York",
    });
    const res = await post(`/api/issues/${issue.number}/complete`, {});
    const updated = res.body as { due_date: string };
    expect(updated.due_date).toBe("2025-03-09");
  });

  it("rejects unsupported recurrence rules", async () => {
    const bad = await post("/api/issues", {
      title: "bad rule",
      recurrence_rule: "FREQ=YEARLY",
    });
    expect(bad.status).toBe(400);
  });
});
