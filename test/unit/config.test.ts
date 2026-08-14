/** CALENDAR_DEFAULT_VIEW resolution: valid values, missing config, fallback. */
import { describe, expect, it } from "vitest";
import { DEFAULT_CALENDAR_VIEW, resolveCalendarDefaultView } from "../../src/shared/contracts/config";

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
