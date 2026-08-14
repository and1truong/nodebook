/** Runtime configuration resolution: valid values, missing config, fallback. */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CALENDAR_VIEW,
  DEFAULT_WEEK_START_DAY,
  WEEK_START_DAYS,
  resolveCalendarDefaultView,
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
