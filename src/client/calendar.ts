/**
 * Deterministic civil-date arithmetic for the Calendar workspace.
 *
 * Every calculation works on YYYY-MM-DD strings and Date.UTC so results never
 * depend on the host's local timezone or a timezone database — month grids,
 * week starts, and navigation are pure calendar math (proleptic Gregorian,
 * Sunday-first weeks to match DatePicker).
 */
import { civilDateString, civilFromInstant, daysInMonth, instantFromCivil, parseCivilDate } from "../shared/time";
import type { CalendarItemDto, IssueDto } from "../shared/contracts/issues";
import type { CalendarView } from "../shared/contracts/config";

/** Re-exported for callers that previously imported the union here. */
export type { CalendarView };

export const WEEKDAY_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
export const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface DateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export function parseDate(date: string): DateParts | null {
  const parts = parseCivilDate(date);
  if (!parts) return null;
  return { year: parts.year, month: parts.month, day: parts.day };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toIso(parts: DateParts): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Date `days` days after (or before, when negative) `date`. */
export function addDays(date: string, days: number): string {
  const parts = parseDate(date);
  if (!parts) throw new Error(`Invalid civil date: ${date}`);
  const dt = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return toIso({ year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() });
}

/** Weekday of `date`: 0 = Sunday … 6 = Saturday. */
export function weekday(date: string): number {
  const parts = parseDate(date);
  if (!parts) throw new Error(`Invalid civil date: ${date}`);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

/** The Sunday on or before `date` (start of the Sunday-first week). */
export function startOfWeek(date: string): string {
  return addDays(date, -weekday(date));
}

/**
 * `delta` months after (or before) `date`, clamping the day of month to the
 * target month's length: Jan 31 + 1 month = Feb 28 (or 29 in a leap year).
 */
export function addMonths(date: string, delta: number): string {
  const parts = parseDate(date);
  if (!parts) throw new Error(`Invalid civil date: ${date}`);
  const total = parts.year * 12 + (parts.month - 1) + delta;
  const year = Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12 + 1;
  const day = Math.min(parts.day, daysInMonth(year, month));
  return toIso({ year, month, day });
}

/**
 * The 42 dates of the six-week Sunday-first grid containing `date`'s month:
 * leading/trailing days from the adjacent months are included so the grid is
 * always exactly 6 rows.
 */
export function monthGrid(date: string): string[] {
  const parts = parseDate(date);
  if (!parts) throw new Error(`Invalid civil date: ${date}`);
  const first = toIso({ year: parts.year, month: parts.month, day: 1 });
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** The seven dates of the Sunday-first week containing `date`. */
export function weekDays(date: string): string[] {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** End-exclusive civil range a view must fetch for `date`. */
export interface DateRange {
  start: string;
  end: string;
}

export function viewRange(view: CalendarView, date: string): DateRange {
  if (view === "day") return { start: date, end: addDays(date, 1) };
  if (view === "week") {
    const start = startOfWeek(date);
    return { start, end: addDays(start, 7) };
  }
  const start = monthGrid(date)[0]!;
  return { start, end: addDays(start, 42) };
}

/** Previous/next selection for a view: days, weeks, or clamped months. */
export function navigate(view: CalendarView, date: string, delta: number): string {
  if (view === "day") return addDays(date, delta);
  if (view === "week") return addDays(date, delta * 7);
  return addMonths(date, delta);
}

export function monthLabel(date: string): string {
  const parts = parseDate(date);
  if (!parts) return "";
  return `${MONTH_NAMES[parts.month - 1] ?? ""} ${parts.year}`;
}

/** "February 2025" style label for a month-grid cell's containing month. */
export function isSameMonth(date: string, anchor: string): boolean {
  const a = parseDate(date);
  const b = parseDate(anchor);
  return a !== null && b !== null && a.year === b.year && a.month === b.month;
}

/** Human label for a view's visible range, e.g. "February 2025". */
export function viewLabel(view: CalendarView, date: string): string {
  if (view === "month") return monthLabel(date);
  const parts = parseDate(date);
  if (!parts) return "";
  if (view === "day") {
    const longName = WEEKDAY_LONG[weekday(date)] ?? "";
    return `${longName}, ${MONTH_NAMES[parts.month - 1] ?? ""} ${parts.day}, ${parts.year}`;
  }
  // Week: "Feb 9 – 15, 2025" or "Dec 29, 2024 – Jan 4, 2025".
  const days = weekDays(date);
  const start = parseDate(days[0]!)!;
  const end = parseDate(days[6]!)!;
  const fmt = (p: DateParts, withYear: boolean) =>
    `${MONTH_NAMES[p.month - 1]!.slice(0, 3)} ${p.day}${withYear ? `, ${p.year}` : ""}`;
  if (start.year === end.year && start.month === end.month) {
    return `${fmt(start, false)} – ${end.day}, ${end.year}`;
  }
  if (start.year === end.year) {
    return `${fmt(start, false)}, ${start.year} – ${fmt(end, false)}, ${end.year}`;
  }
  return `${fmt(start, true)} – ${fmt(end, true)}`;
}

// ---------------------------------------------------------------------------
// Rescheduling
// ---------------------------------------------------------------------------

/** Field-specific issue patch produced by moving a calendar entry. */
export type IssuePatch = {
  due_date?: string;
  scheduled_date?: string;
};

/**
 * Patch for moving `item` to `targetDate` (viewer-local civil date), or null
 * for same-date and invalid drops (no-op). Due entries move only `due_date`;
 * scheduled entries move only `scheduled_date`, preserving the viewer-local
 * wall-clock time via civil-time helpers (DST-safe: spring-forward gaps land
 * on the post-transition instant, fall-back overlaps pick the first one).
 */
export function reschedulePatch(
  item: CalendarItemDto,
  targetDate: string,
  timezone: string,
): IssuePatch | null {
  if (item.date === targetDate) return null;
  const target = parseDate(targetDate);
  if (!target) return null;
  if (item.kind === "due") return { due_date: targetDate };
  const iso = item.issue.scheduled_date;
  if (!iso) return null;
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  const civil = civilFromInstant(instant, timezone);
  const next = instantFromCivil(timezone, {
    year: target.year,
    month: target.month,
    day: target.day,
    hour: civil.hour,
    minute: civil.minute,
    second: civil.second,
  });
  const nextIso = next.toISOString();
  if (nextIso === iso) return null;
  return { scheduled_date: nextIso };
}

/** Server-compatible deterministic ordering: date, kind, then issue number. */
export function calendarEntryOrder(a: CalendarItemDto, b: CalendarItemDto): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === "due" ? -1 : 1;
  return a.issue.number - b.issue.number;
}

/** The calendar entries of `issue` (both kinds) within the visible range. */
export function entriesForIssue(issue: IssueDto, range: DateRange, timezone: string): CalendarItemDto[] {
  const out: CalendarItemDto[] = [];
  if (issue.due_date && issue.due_date >= range.start && issue.due_date < range.end) {
    out.push({ issue, date: issue.due_date, kind: "due" });
  }
  if (issue.scheduled_date) {
    const instant = new Date(issue.scheduled_date);
    if (!Number.isNaN(instant.getTime())) {
      const date = civilDateString(instant, timezone);
      if (date >= range.start && date < range.end) {
        out.push({ issue, date, kind: "scheduled" });
      }
    }
  }
  return out;
}

/**
 * Replace every entry of `issue` with entries recomputed from its (possibly
 * locally patched) DTO, keeping other issues' entries and the deterministic
 * server order. Used for optimistic moves and post-PATCH reconciliation.
 */
export function reconcileCalendarItems(
  items: CalendarItemDto[],
  issue: IssueDto,
  range: DateRange,
  timezone: string,
): CalendarItemDto[] {
  return [...items.filter((i) => i.issue.id !== issue.id), ...entriesForIssue(issue, range, timezone)].sort(
    calendarEntryOrder,
  );
}
