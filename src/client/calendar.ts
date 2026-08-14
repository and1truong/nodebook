/**
 * Deterministic civil-date arithmetic for the Calendar workspace.
 *
 * Every calculation works on YYYY-MM-DD strings and Date.UTC so results never
 * depend on the host's local timezone or a timezone database — month grids,
 * week starts, and navigation are pure calendar math (proleptic Gregorian,
 * Sunday-first weeks to match DatePicker).
 */
import { daysInMonth, parseCivilDate } from "../shared/time";

export type CalendarView = "day" | "week" | "month";

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
