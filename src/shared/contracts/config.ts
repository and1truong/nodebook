/**
 * Runtime application configuration shared by the Worker and the browser
 * client. `calendar_default_view` is resolved from the `CALENDAR_DEFAULT_VIEW`
 * Worker variable (missing or invalid values fall back to "week") and exposed
 * through the authenticated /api/me endpoint — no build-time Vite config.
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

/** Identity + runtime configuration returned by GET /api/me. */
export interface AppConfigDto {
  email: string;
  actor_type: string;
  calendar_default_view: CalendarView;
}
