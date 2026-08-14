/**
 * Pure Calendar entry expansion shared by the Worker and optimistic client.
 * Keeping range filtering and ordering here ensures the API response and
 * post-mutation reconciliation cannot drift apart.
 */
import type { CalendarItemDto, IssueDto } from "./contracts/issues";
import { civilDateString } from "./time";

export interface CalendarDateRange {
  start: string;
  end: string;
}

/** Server-compatible deterministic ordering: date, kind, then issue number. */
export function calendarEntryOrder(a: CalendarItemDto, b: CalendarItemDto): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === "due" ? -1 : 1;
  return a.issue.number - b.issue.number;
}

/** Expand one issue into its due and scheduled entries inside [start, end). */
export function calendarEntriesForIssue(
  issue: IssueDto,
  range: CalendarDateRange,
  timezone: string,
): CalendarItemDto[] {
  const entries: CalendarItemDto[] = [];
  if (issue.due_date && issue.due_date >= range.start && issue.due_date < range.end) {
    entries.push({ issue, date: issue.due_date, kind: "due" });
  }
  if (issue.scheduled_date) {
    const instant = new Date(issue.scheduled_date);
    if (!Number.isNaN(instant.getTime())) {
      const date = civilDateString(instant, timezone);
      if (date >= range.start && date < range.end) {
        entries.push({ issue, date, kind: "scheduled" });
      }
    }
  }
  return entries;
}

/** Expand and deterministically order a collection of issues. */
export function calendarEntriesForIssues(
  issues: readonly IssueDto[],
  range: CalendarDateRange,
  timezone: string,
): CalendarItemDto[] {
  return issues.flatMap((issue) => calendarEntriesForIssue(issue, range, timezone)).sort(calendarEntryOrder);
}
