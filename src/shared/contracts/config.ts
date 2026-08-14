/**
 * Runtime application configuration shared by the Worker and the browser
 * client. Values are resolved from Worker variables (missing or invalid
 * values fall back to documented defaults) and exposed through the
 * authenticated /api/me endpoint — no build-time Vite config.
 *  - `calendar_default_view` ← `CALENDAR_DEFAULT_VIEW` (default "week")
 *  - `week_start_day` ← `WEEK_START_DAY` (default "sunday")
 */

/** Calendar view modes. Week is the deployment default. */
export type CalendarView = "day" | "week" | "month";

export const CALENDAR_VIEWS: readonly CalendarView[] = ["day", "week", "month"];

export const DEFAULT_CALENDAR_VIEW: CalendarView = "week";

/** Resolve the raw Worker variable to a valid CalendarView. */
export function resolveCalendarDefaultView(raw: string | null | undefined): CalendarView {
  const v = raw?.trim();
  return v === "day" || v === "week" || v === "month" ? v : DEFAULT_CALENDAR_VIEW;
}

/** First day of the calendar week (lowercase weekday names). Sunday default. */
export type WeekStartDay = "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";

/** All valid week-start days, indexed by weekday number (0 = Sunday … 6 = Saturday). */
export const WEEK_START_DAYS: readonly WeekStartDay[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export const DEFAULT_WEEK_START_DAY: WeekStartDay = "sunday";

/** Resolve the raw Worker variable to a valid WeekStartDay. */
export function resolveWeekStartDay(raw: string | null | undefined): WeekStartDay {
  const v = raw?.trim();
  return (WEEK_START_DAYS as readonly string[]).includes(v ?? "") ? (v as WeekStartDay) : DEFAULT_WEEK_START_DAY;
}

/** Weekday number of the week-start day: 0 = Sunday … 6 = Saturday. */
export function weekStartIndex(day: WeekStartDay): number {
  return WEEK_START_DAYS.indexOf(day);
}

/** Identity + runtime configuration returned by GET /api/me. */
export interface AppConfigDto {
  email: string;
  actor_type: string;
  calendar_default_view: CalendarView;
  week_start_day: WeekStartDay;
}
