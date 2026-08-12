import { describe, expect, it } from "vitest";
import {
  civilFromInstant,
  civilDateString,
  dayRange,
  instantFromCivil,
  isValidTimezone,
  todayCivil,
  utcOffsetMinutes,
} from "../../src/shared/time";

describe("civil time helpers", () => {
  it("converts UTC instants to civil parts", () => {
    expect(civilFromInstant(new Date("2025-03-08T09:00:00.000Z"), "UTC")).toEqual({
      year: 2025,
      month: 3,
      day: 8,
      hour: 9,
      minute: 0,
      second: 0,
    });
  });

  it("converts to a non-UTC timezone", () => {
    const c = civilFromInstant(new Date("2025-03-08T09:00:00.000Z"), "America/New_York");
    expect(c.hour).toBe(4); // EST = UTC-5
  });

  it("reports offsets including DST", () => {
    expect(utcOffsetMinutes(new Date("2025-01-15T00:00:00.000Z"), "America/New_York")).toBe(-300);
    expect(utcOffsetMinutes(new Date("2025-07-15T00:00:00.000Z"), "America/New_York")).toBe(-240);
  });

  it("round-trips civil → instant → civil", () => {
    const tz = "Europe/Berlin";
    const parts = { year: 2025, month: 6, day: 15, hour: 10, minute: 30, second: 0 };
    const instant = instantFromCivil(tz, parts);
    expect(civilFromInstant(instant, tz)).toEqual(parts);
  });

  it("resolves spring-forward gap times to the post-transition instant", () => {
    // 2025-03-09 02:30 in New York does not exist; deterministic resolution.
    const instant = instantFromCivil("America/New_York", { year: 2025, month: 3, day: 9, hour: 2, minute: 30, second: 0 });
    expect(civilFromInstant(instant, "America/New_York").hour).toBeGreaterThanOrEqual(3);
  });

  it("resolves fall-back overlap deterministically", () => {
    // 2025-11-02 01:30 occurs twice in New York; picks the first occurrence.
    const instant = instantFromCivil("America/New_York", { year: 2025, month: 11, day: 2, hour: 1, minute: 30, second: 0 });
    expect(utcOffsetMinutes(instant, "America/New_York")).toBe(-240); // EDT (first pass)
  });

  it("computes civil dates and day ranges", () => {
    expect(civilDateString(new Date("2025-03-08T04:00:00.000Z"), "America/New_York")).toBe("2025-03-07");
    expect(todayCivil(new Date("2025-03-08T12:00:00.000Z"), "UTC")).toBe("2025-03-08");

    const [start, end] = dayRange("2025-03-08", "UTC");
    expect(start.toISOString()).toBe("2025-03-08T00:00:00.000Z");
    expect(end.toISOString()).toBe("2025-03-09T00:00:00.000Z");

    const [nyStart] = dayRange("2025-03-08", "America/New_York");
    expect(nyStart.toISOString()).toBe("2025-03-08T05:00:00.000Z");
  });

  it("validates timezones", () => {
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("Not/AZone")).toBe(false);
  });
});
