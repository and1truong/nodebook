/**
 * Runtime application configuration shared by the Worker and the browser
 * client. Values are resolved from Worker variables (missing or invalid
 * values fall back to documented defaults) and exposed through the
 * authenticated /api/me endpoint — no build-time Vite config.
 *  - `calendar_default_view` ← `CALENDAR_DEFAULT_VIEW` (default "week")
 *  - `week_start_day` ← `WEEK_START_DAY` (default "sunday")
 *  - `issues_default_limit` ← `ISSUES_DEFAULT_LIMIT` (default 20)
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

/** Page sizes offered by the Issues list. */
export const ISSUE_PAGE_LIMITS = [20, 50, 100] as const;
export type IssuePageLimit = (typeof ISSUE_PAGE_LIMITS)[number];
export const DEFAULT_ISSUES_PAGE_LIMIT: IssuePageLimit = 20;

/** Resolve the Issues page's default size, accepting only selectable values. */
export function resolveIssuesDefaultLimit(raw: string | null | undefined): IssuePageLimit {
  const value = Number(raw?.trim());
  return (ISSUE_PAGE_LIMITS as readonly number[]).includes(value)
    ? (value as IssuePageLimit)
    : DEFAULT_ISSUES_PAGE_LIMIT;
}

/** Identity + runtime configuration returned by GET /api/me. */
export interface AppConfigDto {
  email: string;
  actor_type: string;
  calendar_default_view: CalendarView;
  week_start_day: WeekStartDay;
  issues_default_limit: IssuePageLimit;
}
