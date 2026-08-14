/** Calendar arithmetic: intervals, grids, and navigation across boundaries. */
import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  isSameMonth,
  monthGrid,
  monthLabel,
  navigate,
  startOfWeek,
  viewLabel,
  viewRange,
  weekDays,
  weekday,
} from "../../src/client/calendar";

describe("calendar arithmetic", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2025-01-01", 0)).toBe("2025-01-01");
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29"); // leap year
    expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
    expect(addDays("2024-12-31", 1)).toBe("2025-01-01");
    expect(addDays("2025-01-01", -1)).toBe("2024-12-31");
    expect(addDays("2025-03-01", -1)).toBe("2025-02-28");
  });

  it("computes Sunday-first weekdays and week starts", () => {
    expect(weekday("2025-02-09")).toBe(0); // Sunday
    expect(weekday("2025-02-12")).toBe(3); // Wednesday
    expect(weekday("2025-02-15")).toBe(6); // Saturday
    expect(startOfWeek("2025-02-12")).toBe("2025-02-09");
    expect(startOfWeek("2025-02-09")).toBe("2025-02-09");
    expect(startOfWeek("2025-01-01")).toBe("2024-12-29"); // year boundary
  });

  it("builds a 42-day Sunday-first month grid including adjacent months", () => {
    // February 2025: the 1st is a Saturday, so the grid starts Jan 26.
    const grid = monthGrid("2025-02-10");
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe("2025-01-26");
    expect(grid[41]).toBe("2025-03-08");
    for (let i = 1; i < grid.length; i++) {
      expect(addDays(grid[i - 1]!, 1)).toBe(grid[i]!);
    }
    expect(grid).toContain("2025-02-28");
    expect(grid).not.toContain("2025-02-29"); // 2025 is not a leap year
  });

  it("handles leap February and December year-boundary grids", () => {
    // February 2024 (leap): the 1st is a Thursday, so the grid starts Jan 28.
    const leap = monthGrid("2024-02-15");
    expect(leap[0]).toBe("2024-01-28");
    expect(leap).toContain("2024-02-29");
    // December 2025: the 1st is a Monday, so the grid starts Nov 30 and
    // spills into January 2026.
    const dec = monthGrid("2025-12-15");
    expect(dec[0]).toBe("2025-11-30");
    expect(dec[41]).toBe("2026-01-10");
    expect(dec).toContain("2025-12-31");
    expect(dec).toContain("2026-01-01");
  });

  it("returns the seven dates of the containing Sunday-first week", () => {
    expect(weekDays("2025-02-12")).toEqual([
      "2025-02-09", "2025-02-10", "2025-02-11", "2025-02-12",
      "2025-02-13", "2025-02-14", "2025-02-15",
    ]);
    expect(weekDays("2025-01-01")[0]).toBe("2024-12-29");
  });

  it("computes end-exclusive view ranges", () => {
    expect(viewRange("day", "2025-02-12")).toEqual({ start: "2025-02-12", end: "2025-02-13" });
    expect(viewRange("week", "2025-02-12")).toEqual({ start: "2025-02-09", end: "2025-02-16" });
    expect(viewRange("month", "2025-02-10")).toEqual({ start: "2025-01-26", end: "2025-03-09" });
    // A month grid is always 42 days regardless of the month's shape.
    expect(viewRange("month", "2025-02-10").end).toBe(addDays(viewRange("month", "2025-02-10").start, 42));
  });

  it("navigates by days, weeks, and clamped months", () => {
    expect(navigate("day", "2025-02-12", 1)).toBe("2025-02-13");
    expect(navigate("day", "2025-02-12", -1)).toBe("2025-02-11");
    expect(navigate("day", "2024-12-31", 1)).toBe("2025-01-01");
    expect(navigate("week", "2025-02-12", 1)).toBe("2025-02-19");
    expect(navigate("week", "2025-02-12", -1)).toBe("2025-02-05");
    // Week navigation crosses year boundaries cleanly.
    expect(navigate("week", "2025-01-01", -1)).toBe("2024-12-25");
  });

  it("clamps day-of-month when navigating months", () => {
    expect(navigate("month", "2025-01-31", 1)).toBe("2025-02-28");
    expect(navigate("month", "2024-01-31", 1)).toBe("2024-02-29"); // leap year
    expect(navigate("month", "2024-01-31", 2)).toBe("2024-03-31"); // un-clamps forward
    expect(navigate("month", "2025-03-31", -1)).toBe("2025-02-28");
    expect(navigate("month", "2025-03-15", -1)).toBe("2025-02-15");
    expect(navigate("month", "2025-12-15", 1)).toBe("2026-01-15");
    expect(navigate("month", "2025-01-15", -1)).toBe("2024-12-15");
  });

  it("adds months without disturbing the day when possible", () => {
    expect(addMonths("2025-06-30", 1)).toBe("2025-07-30");
    expect(addMonths("2025-06-30", 6)).toBe("2025-12-30");
    expect(addMonths("2025-06-30", 12)).toBe("2026-06-30");
  });

  it("labels months and views", () => {
    expect(monthLabel("2025-02-10")).toBe("February 2025");
    expect(monthLabel("2024-12-31")).toBe("December 2024");
    expect(viewLabel("month", "2025-02-10")).toBe("February 2025");
    expect(viewLabel("day", "2025-02-10")).toBe("Monday, February 10, 2025");
    expect(viewLabel("week", "2025-02-12")).toBe("Feb 9 – 15, 2025");
    expect(viewLabel("week", "2025-01-01")).toBe("Dec 29, 2024 – Jan 4, 2025");
    // A Monday late in December belongs to the Sunday-first week that starts
    // Dec 29, 2024 and ends Jan 4, 2025.
    expect(viewLabel("week", "2024-12-30")).toBe("Dec 29, 2024 – Jan 4, 2025");
  });

  it("compares dates within the same month", () => {
    expect(isSameMonth("2025-02-01", "2025-02-28")).toBe(true);
    expect(isSameMonth("2025-01-31", "2025-02-01")).toBe(false);
    expect(isSameMonth("2024-12-31", "2025-01-01")).toBe(false);
  });
});
