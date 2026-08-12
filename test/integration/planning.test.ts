/** Planning views and recurring-task behavior. */
import { describe, expect, it } from "vitest";
import { api, createIssue, post, testEnv } from "./helpers";

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
