/** Calendar arithmetic: intervals, grids, and navigation across boundaries. */
import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  isSameMonth,
  monthGrid,
  monthLabel,
  navigate,
  reconcileCalendarItems,
  reschedulePatch,
  startOfWeek,
  viewLabel,
  viewRange,
  weekDays,
  weekday,
} from "../../src/client/calendar";

describe("calendar arithmetic", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2025-01-01", 0)).toBe("2025-01-01");
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29"); // leap year
    expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
    expect(addDays("2024-12-31", 1)).toBe("2025-01-01");
    expect(addDays("2025-01-01", -1)).toBe("2024-12-31");
    expect(addDays("2025-03-01", -1)).toBe("2025-02-28");
  });

  it("computes Sunday-first weekdays and week starts", () => {
    expect(weekday("2025-02-09")).toBe(0); // Sunday
    expect(weekday("2025-02-12")).toBe(3); // Wednesday
    expect(weekday("2025-02-15")).toBe(6); // Saturday
    expect(startOfWeek("2025-02-12")).toBe("2025-02-09");
    expect(startOfWeek("2025-02-09")).toBe("2025-02-09");
    expect(startOfWeek("2025-01-01")).toBe("2024-12-29"); // year boundary
  });

  it("builds a 42-day Sunday-first month grid including adjacent months", () => {
    // February 2025: the 1st is a Saturday, so the grid starts Jan 26.
    const grid = monthGrid("2025-02-10");
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe("2025-01-26");
    expect(grid[41]).toBe("2025-03-08");
    for (let i = 1; i < grid.length; i++) {
      expect(addDays(grid[i - 1]!, 1)).toBe(grid[i]!);
    }
    expect(grid).toContain("2025-02-28");
    expect(grid).not.toContain("2025-02-29"); // 2025 is not a leap year
  });

  it("handles leap February and December year-boundary grids", () => {
    // February 2024 (leap): the 1st is a Thursday, so the grid starts Jan 28.
    const leap = monthGrid("2024-02-15");
    expect(leap[0]).toBe("2024-01-28");
    expect(leap).toContain("2024-02-29");
    // December 2025: the 1st is a Monday, so the grid starts Nov 30 and
    // spills into January 2026.
    const dec = monthGrid("2025-12-15");
    expect(dec[0]).toBe("2025-11-30");
    expect(dec[41]).toBe("2026-01-10");
    expect(dec).toContain("2025-12-31");
    expect(dec).toContain("2026-01-01");
  });

  it("returns the seven dates of the containing Sunday-first week", () => {
    expect(weekDays("2025-02-12")).toEqual([
      "2025-02-09", "2025-02-10", "2025-02-11", "2025-02-12",
      "2025-02-13", "2025-02-14", "2025-02-15",
    ]);
    expect(weekDays("2025-01-01")[0]).toBe("2024-12-29");
  });

  it("computes end-exclusive view ranges", () => {
    expect(viewRange("day", "2025-02-12")).toEqual({ start: "2025-02-12", end: "2025-02-13" });
    expect(viewRange("week", "2025-02-12")).toEqual({ start: "2025-02-09", end: "2025-02-16" });
    expect(viewRange("month", "2025-02-10")).toEqual({ start: "2025-01-26", end: "2025-03-09" });
    // A month grid is always 42 days regardless of the month's shape.
    expect(viewRange("month", "2025-02-10").end).toBe(addDays(viewRange("month", "2025-02-10").start, 42));
  });

  it("navigates by days, weeks, and clamped months", () => {
    expect(navigate("day", "2025-02-12", 1)).toBe("2025-02-13");
    expect(navigate("day", "2025-02-12", -1)).toBe("2025-02-11");
    expect(navigate("day", "2024-12-31", 1)).toBe("2025-01-01");
    expect(navigate("week", "2025-02-12", 1)).toBe("2025-02-19");
    expect(navigate("week", "2025-02-12", -1)).toBe("2025-02-05");
    // Week navigation crosses year boundaries cleanly.
    expect(navigate("week", "2025-01-01", -1)).toBe("2024-12-25");
  });

  it("clamps day-of-month when navigating months", () => {
    expect(navigate("month", "2025-01-31", 1)).toBe("2025-02-28");
    expect(navigate("month", "2024-01-31", 1)).toBe("2024-02-29"); // leap year
    expect(navigate("month", "2024-01-31", 2)).toBe("2024-03-31"); // un-clamps forward
    expect(navigate("month", "2025-03-31", -1)).toBe("2025-02-28");
    expect(navigate("month", "2025-03-15", -1)).toBe("2025-02-15");
    expect(navigate("month", "2025-12-15", 1)).toBe("2026-01-15");
    expect(navigate("month", "2025-01-15", -1)).toBe("2024-12-15");
  });

  it("adds months without disturbing the day when possible", () => {
    expect(addMonths("2025-06-30", 1)).toBe("2025-07-30");
    expect(addMonths("2025-06-30", 6)).toBe("2025-12-30");
    expect(addMonths("2025-06-30", 12)).toBe("2026-06-30");
  });

  it("labels months and views", () => {
    expect(monthLabel("2025-02-10")).toBe("February 2025");
    expect(monthLabel("2024-12-31")).toBe("December 2024");
    expect(viewLabel("month", "2025-02-10")).toBe("February 2025");
    expect(viewLabel("day", "2025-02-10")).toBe("Monday, February 10, 2025");
    expect(viewLabel("week", "2025-02-12")).toBe("Feb 9 – 15, 2025");
    expect(viewLabel("week", "2025-01-01")).toBe("Dec 29, 2024 – Jan 4, 2025");
    // A Monday late in December belongs to the Sunday-first week that starts
    // Dec 29, 2024 and ends Jan 4, 2025.
    expect(viewLabel("week", "2024-12-30")).toBe("Dec 29, 2024 – Jan 4, 2025");
  });

  it("compares dates within the same month", () => {
    expect(isSameMonth("2025-02-01", "2025-02-28")).toBe(true);
    expect(isSameMonth("2025-01-31", "2025-02-01")).toBe(false);
    expect(isSameMonth("2024-12-31", "2025-01-01")).toBe(false);
  });
});

describe("rescheduling patches", () => {
  const issue = (over: Partial<{ id: string; number: number; due_date: string | null; scheduled_date: string | null }>) => ({
    id: "issue-1",
    number: 7,
    type: "task" as const,
    title: "Move me",
    body: "",
    status: "open" as const,
    priority: null as null,
    labels: [],
    start_date: null,
    due_date: null,
    scheduled_date: null,
    timezone: "UTC" as const,
    recurrence_rule: null,
    parent_id: null,
    parent_number: null,
    created_by: "owner",
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    closed_at: null,
    completed_at: null,
    child_count: 0,
    backlink_count: 0,
    ...over,
  });

  it("moves a due entry by patching only due_date", () => {
    const item = {
      issue: issue({ due_date: "2025-06-10" }),
      date: "2025-06-10",
      kind: "due" as const,
    };
    expect(reschedulePatch(item, "2025-06-12", "UTC")).toEqual({ due_date: "2025-06-12" });
  });

  it("moves a scheduled entry by patching only scheduled_date", () => {
    const item = {
      issue: issue({ scheduled_date: "2025-06-10T09:00:00.000Z" }),
      date: "2025-06-10",
      kind: "scheduled" as const,
    };
    expect(reschedulePatch(item, "2025-06-12", "UTC")).toEqual({ scheduled_date: "2025-06-12T09:00:00.000Z" });
  });

  it("preserves viewer-local wall-clock time when moving a scheduled entry", () => {
    // 13:00Z = 09:00 EDT; moving a day must keep 09:00 in New York.
    const item = {
      issue: issue({ scheduled_date: "2025-06-10T13:00:00.000Z" }),
      date: "2025-06-10",
      kind: "scheduled" as const,
    };
    expect(reschedulePatch(item, "2025-06-12", "America/New_York")).toEqual({
      scheduled_date: "2025-06-12T13:00:00.000Z",
    });
  });

  it("keeps the wall-clock time across DST transitions", () => {
    // Spring forward 2025-03-09 in New York: 09:00 EST → 09:00 EDT.
    const before = {
      issue: issue({ scheduled_date: "2025-03-08T14:00:00.000Z" }), // 09:00 EST
      date: "2025-03-08",
      kind: "scheduled" as const,
    };
    expect(reschedulePatch(before, "2025-03-09", "America/New_York")).toEqual({
      scheduled_date: "2025-03-09T13:00:00.000Z", // 09:00 EDT
    });

    // Fall back 2025-11-02 in New York (2:00 EDT → 1:00 EST): a move from
    // Nov 1 (09:00 EDT = 13:00Z) to Nov 3 must land on 09:00 EST = 14:00Z.
    const after = {
      issue: issue({ scheduled_date: "2025-11-01T13:00:00.000Z" }), // 09:00 EDT
      date: "2025-11-01",
      kind: "scheduled" as const,
    };
    expect(reschedulePatch(after, "2025-11-03", "America/New_York")).toEqual({
      scheduled_date: "2025-11-03T14:00:00.000Z", // 09:00 EST
    });
  });

  it("handles date-boundary moves", () => {
    const item = {
      issue: issue({ due_date: "2025-12-31" }),
      date: "2025-12-31",
      kind: "due" as const,
    };
    expect(reschedulePatch(item, "2026-01-01", "UTC")).toEqual({ due_date: "2026-01-01" });
    const scheduled = {
      issue: issue({ scheduled_date: "2025-12-31T23:30:00.000Z" }),
      date: "2025-12-31",
      kind: "scheduled" as const,
    };
    expect(reschedulePatch(scheduled, "2026-01-01", "UTC")).toEqual({
      scheduled_date: "2026-01-01T23:30:00.000Z",
    });
  });

  it("moves only the corresponding field of a dual entry", () => {
    const dual = issue({ due_date: "2025-06-10", scheduled_date: "2025-06-10T10:00:00.000Z" });
    const due = { issue: dual, date: "2025-06-10", kind: "due" as const };
    expect(reschedulePatch(due, "2025-06-11", "UTC")).toEqual({ due_date: "2025-06-11" });
    const scheduled = { issue: dual, date: "2025-06-10", kind: "scheduled" as const };
    expect(reschedulePatch(scheduled, "2025-06-11", "UTC")).toEqual({
      scheduled_date: "2025-06-11T10:00:00.000Z",
    });
  });

  it("treats same-date and invalid drops as no-ops", () => {
    const due = { issue: issue({ due_date: "2025-06-10" }), date: "2025-06-10", kind: "due" as const };
    expect(reschedulePatch(due, "2025-06-10", "UTC")).toBeNull(); // same date
    expect(reschedulePatch(due, "2025-6-10", "UTC")).toBeNull(); // malformed target
    expect(reschedulePatch(due, "not-a-date", "UTC")).toBeNull();
    const scheduled = { issue: issue({}), date: "2025-06-10", kind: "scheduled" as const };
    expect(reschedulePatch(scheduled, "2025-06-11", "UTC")).toBeNull(); // no instant
    const badInstant = {
      issue: issue({ scheduled_date: "garbage" }),
      date: "2025-06-10",
      kind: "scheduled" as const,
    };
    expect(reschedulePatch(badInstant, "2025-06-11", "UTC")).toBeNull();
  });
});

describe("calendar entry reconciliation", () => {
  const issue = (over: { id: string; number: number; due_date?: string | null; scheduled_date?: string | null }) => ({
    id: over.id,
    number: over.number,
    type: "task" as const,
    title: `Issue ${over.number}`,
    body: "",
    status: "open" as const,
    priority: null as null,
    labels: [],
    start_date: null,
    due_date: over.due_date ?? null,
    scheduled_date: over.scheduled_date ?? null,
    timezone: "UTC" as const,
    recurrence_rule: null,
    parent_id: null,
    parent_number: null,
    created_by: "owner",
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    closed_at: null,
    completed_at: null,
    child_count: 0,
    backlink_count: 0,
  });
  const range = { start: "2025-06-01", end: "2025-07-01" };

  it("replaces every entry of an issue from its DTO and keeps server order", () => {
    const a = issue({ id: "a", number: 2, due_date: "2025-06-05" });
    const b = issue({ id: "b", number: 1, due_date: "2025-06-10", scheduled_date: "2025-06-10T09:00:00.000Z" });
    const items = [
      { issue: b, date: "2025-06-10", kind: "due" as const },
      { issue: a, date: "2025-06-05", kind: "due" as const },
      { issue: b, date: "2025-06-10", kind: "scheduled" as const },
    ];
    const moved = issue({ id: "b", number: 1, due_date: "2025-06-20", scheduled_date: "2025-06-10T09:00:00.000Z" });
    const next = reconcileCalendarItems(items, moved, range, "UTC");
    expect(next).toEqual([
      { issue: a, date: "2025-06-05", kind: "due" },
      { issue: moved, date: "2025-06-10", kind: "scheduled" },
      { issue: moved, date: "2025-06-20", kind: "due" },
    ]);
  });

  it("drops recomputed entries that leave the visible range", () => {
    const a = issue({ id: "a", number: 3, due_date: "2025-06-05" });
    const items = [{ issue: a, date: "2025-06-05", kind: "due" as const }];
    const movedAway = issue({ id: "a", number: 3, due_date: "2025-08-01" });
    expect(reconcileCalendarItems(items, movedAway, range, "UTC")).toEqual([]);
  });
});
