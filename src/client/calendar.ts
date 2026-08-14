/**
 * Deterministic civil-date arithmetic for the Calendar workspace.
 *
 * Every calculation works on YYYY-MM-DD strings and Date.UTC so results never
 * depend on the host's local timezone or a timezone database — month grids,
 * week starts, and navigation are pure calendar math (proleptic Gregorian).
 * Weeks are configurable (WeekStartDay, default Sunday) so the same
 * arithmetic drives the inbox planning shortcuts, the Calendar workspace, and
 * the date pickers.
 */
import { civilFromInstant, daysInMonth, instantFromCivil, parseCivilDate } from "../shared/time";
import type { CalendarItemDto, IssueDto } from "../shared/contracts/issues";
import type { CalendarDateRange } from "../shared/calendar";
import { calendarEntriesForIssue, calendarEntryOrder } from "../shared/calendar";
import type { CalendarView, WeekStartDay } from "../shared/contracts/config";
import { weekStartIndex } from "../shared/contracts/config";

/** Re-exported for callers that previously imported the union here. */
export type { CalendarView };
export type { WeekStartDay };

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

/** The configured week-start day on or before `date` (default Sunday). */
export function startOfWeek(date: string, weekStart: WeekStartDay = "sunday"): string {
  return addDays(date, -((weekday(date) - weekStartIndex(weekStart) + 7) % 7));
}

/** First day of the week strictly following the week containing `date`. */
export function startOfNextWeek(date: string, weekStart: WeekStartDay = "sunday"): string {
  return addDays(startOfWeek(date, weekStart), 7);
}

/** First day of the calendar month strictly following `date`'s month. */
export function startOfNextMonth(date: string): string {
  const parts = parseDate(date);
  if (!parts) throw new Error(`Invalid civil date: ${date}`);
  const year = parts.month === 12 ? parts.year + 1 : parts.year;
  const month = parts.month === 12 ? 1 : parts.month + 1;
  return toIso({ year, month, day: 1 });
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
 * The 42 dates of the six-week grid containing `date`'s month, starting on
 * the configured week-start day: leading/trailing days from the adjacent
 * months are included so the grid is always exactly 6 rows.
 */
export function monthGrid(date: string, weekStart: WeekStartDay = "sunday"): string[] {
  const parts = parseDate(date);
  if (!parts) throw new Error(`Invalid civil date: ${date}`);
  const first = toIso({ year: parts.year, month: parts.month, day: 1 });
  const start = startOfWeek(first, weekStart);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** The seven dates of the week containing `date`, from the configured start. */
export function weekDays(date: string, weekStart: WeekStartDay = "sunday"): string[] {
  const start = startOfWeek(date, weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** WEEKDAY_SHORT rotated so the configured week-start day comes first. */
export function weekdayHeaders(weekStart: WeekStartDay = "sunday"): string[] {
  const i = weekStartIndex(weekStart);
  return [...WEEKDAY_SHORT.slice(i), ...WEEKDAY_SHORT.slice(0, i)];
}

/** End-exclusive civil range a view must fetch for `date`. */
export type DateRange = CalendarDateRange;

export function viewRange(
  view: CalendarView,
  date: string,
  weekStart: WeekStartDay = "sunday",
): DateRange {
  if (view === "day") return { start: date, end: addDays(date, 1) };
  if (view === "week") {
    const start = startOfWeek(date, weekStart);
    return { start, end: addDays(start, 7) };
  }
  const start = monthGrid(date, weekStart)[0]!;
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
export function viewLabel(view: CalendarView, date: string, weekStart: WeekStartDay = "sunday"): string {
  if (view === "month") return monthLabel(date);
  const parts = parseDate(date);
  if (!parts) return "";
  if (view === "day") {
    const longName = WEEKDAY_LONG[weekday(date)] ?? "";
    return `${longName}, ${MONTH_NAMES[parts.month - 1] ?? ""} ${parts.day}, ${parts.year}`;
  }
  // Week: "Feb 9 – 15, 2025" or "Dec 29, 2024 – Jan 4, 2025".
  const days = weekDays(date, weekStart);
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
 * wall-clock time unless `targetTime` (HH:mm) is supplied by the day timeline.
 * Civil-time conversion is DST-safe: spring-forward gaps land on the
 * post-transition instant and fall-back overlaps pick the first occurrence.
 */
export function reschedulePatch(
  item: CalendarItemDto,
  targetDate: string,
  timezone: string,
  targetTime?: string,
): IssuePatch | null {
  const target = parseDate(targetDate);
  if (!target) return null;
  if (item.kind === "due") {
    return item.date === targetDate ? null : { due_date: targetDate };
  }
  const timeMatch = targetTime === undefined ? null : /^([01]\d|2[0-3]):([0-5]\d)$/.exec(targetTime);
  if (targetTime !== undefined && !timeMatch) return null;
  if (item.date === targetDate && targetTime === undefined) return null;
  const iso = item.issue.scheduled_date;
  if (!iso) return null;
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  const civil = civilFromInstant(instant, timezone);
  const next = instantFromCivil(timezone, {
    year: target.year,
    month: target.month,
    day: target.day,
    hour: timeMatch ? Number(timeMatch[1]) : civil.hour,
    minute: timeMatch ? Number(timeMatch[2]) : civil.minute,
    second: timeMatch ? 0 : civil.second,
  });
  const nextIso = next.toISOString();
  if (nextIso === iso) return null;
  return { scheduled_date: nextIso };
}

/** Backward-compatible names for the shared API/client expansion rules. */
export { calendarEntryOrder };
export const entriesForIssue = calendarEntriesForIssue;

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
  return [...items.filter((i) => i.issue.id !== issue.id), ...calendarEntriesForIssue(issue, range, timezone)].sort(
    calendarEntryOrder,
  );
}
