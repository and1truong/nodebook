/** Runtime configuration resolution: valid values, missing config, fallback. */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CALENDAR_VIEW,
  DEFAULT_ISSUES_PAGE_LIMIT,
  DEFAULT_WEEK_START_DAY,
  ISSUE_PAGE_LIMITS,
  WEEK_START_DAYS,
  resolveCalendarDefaultView,
  resolveIssuesDefaultLimit,
  resolveWeekStartDay,
  weekStartIndex,
} from "../../src/shared/contracts/config";

describe("resolveCalendarDefaultView", () => {
  it("accepts every valid view value", () => {
    expect(resolveCalendarDefaultView("day")).toBe("day");
    expect(resolveCalendarDefaultView("week")).toBe("week");
    expect(resolveCalendarDefaultView("month")).toBe("month");
  });

  it("falls back to week when the variable is missing", () => {
    expect(resolveCalendarDefaultView(undefined)).toBe("week");
    expect(resolveCalendarDefaultView(null)).toBe("week");
  });

  it("falls back to week for empty and invalid values", () => {
    expect(resolveCalendarDefaultView("")).toBe("week");
    expect(resolveCalendarDefaultView("   ")).toBe("week");
    expect(resolveCalendarDefaultView("year")).toBe("week");
    expect(resolveCalendarDefaultView("WEEK")).toBe("week");
    expect(resolveCalendarDefaultView("day,week")).toBe("week");
  });

  it("exposes the fallback constant for configuration and tests", () => {
    expect(DEFAULT_CALENDAR_VIEW).toBe("week");
  });
});

describe("resolveIssuesDefaultLimit", () => {
  it("accepts every selectable page size", () => {
    expect(ISSUE_PAGE_LIMITS).toEqual([20, 50, 100]);
    for (const limit of ISSUE_PAGE_LIMITS) {
      expect(resolveIssuesDefaultLimit(String(limit))).toBe(limit);
    }
  });

  it("falls back to 20 when the variable is missing or invalid", () => {
    expect(resolveIssuesDefaultLimit(undefined)).toBe(20);
    expect(resolveIssuesDefaultLimit(null)).toBe(20);
    expect(resolveIssuesDefaultLimit("")).toBe(20);
    expect(resolveIssuesDefaultLimit("10")).toBe(20);
    expect(resolveIssuesDefaultLimit("200")).toBe(20);
    expect(resolveIssuesDefaultLimit("50 rows")).toBe(20);
    expect(DEFAULT_ISSUES_PAGE_LIMIT).toBe(20);
  });
});

describe("resolveWeekStartDay", () => {
  it("accepts every valid weekday", () => {
    expect(WEEK_START_DAYS).toEqual([
      "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
    ]);
    for (const day of WEEK_START_DAYS) {
      expect(resolveWeekStartDay(day)).toBe(day);
    }
  });

  it("falls back to sunday when the variable is missing", () => {
    expect(resolveWeekStartDay(undefined)).toBe("sunday");
    expect(resolveWeekStartDay(null)).toBe("sunday");
  });

  it("falls back to sunday for empty and invalid values", () => {
    expect(resolveWeekStartDay("")).toBe("sunday");
    expect(resolveWeekStartDay("   ")).toBe("sunday");
    expect(resolveWeekStartDay("MONDAY")).toBe("sunday");
    expect(resolveWeekStartDay("monday,wednesday")).toBe("sunday");
    expect(resolveWeekStartDay("funday")).toBe("sunday");
  });

  it("exposes the fallback constant for configuration and tests", () => {
    expect(DEFAULT_WEEK_START_DAY).toBe("sunday");
  });

  it("maps week-start days to weekday numbers (0 = Sunday … 6 = Saturday)", () => {
    expect(weekStartIndex("sunday")).toBe(0);
    expect(weekStartIndex("monday")).toBe(1);
    expect(weekStartIndex("saturday")).toBe(6);
  });
});
