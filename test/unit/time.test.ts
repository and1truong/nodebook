import { describe, expect, it } from "vitest";
import {
  addCivilMonths,
  civilDateTimeString,
  civilFromInstant,
  civilDateString,
  dayRange,
  instantFromCivil,
  isValidTimezone,
  parseCivilDate,
  parseCivilDateTime,
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

  it("adds calendar months and clamps month-end dates", () => {
    expect(addCivilMonths("2025-01-15", 1)).toBe("2025-02-15");
    expect(addCivilMonths("2025-01-31", 1)).toBe("2025-02-28");
    expect(addCivilMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addCivilMonths("2025-12-31", 1)).toBe("2026-01-31");
    expect(addCivilMonths("2025-03-31", -1)).toBe("2025-02-28");
  });

  it("rejects invalid input to addCivilMonths", () => {
    expect(() => addCivilMonths("2025-02-30", 1)).toThrow();
    expect(() => addCivilMonths("not-a-date", 1)).toThrow();
    expect(() => addCivilMonths("2025-01-15", 1.5)).toThrow();
  });

  it("validates timezones", () => {
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("Not/AZone")).toBe(false);
  });

  it("rejects nonexistent calendar dates", () => {
    expect(parseCivilDate("2025-02-31")).toBeNull(); // February never has 31 days
    expect(parseCivilDate("2025-02-29")).toBeNull(); // 2025 is not a leap year
    expect(parseCivilDate("2025-04-31")).toBeNull(); // April has 30 days
    expect(parseCivilDate("2025-00-10")).toBeNull();
    expect(parseCivilDate("2025-13-01")).toBeNull();
    expect(parseCivilDate("2025-01-00")).toBeNull();
    expect(parseCivilDate("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29, hour: 0, minute: 0, second: 0 }); // leap year
    expect(parseCivilDate("2025-12-31")).toEqual({ year: 2025, month: 12, day: 31, hour: 0, minute: 0, second: 0 });
  });

  it("formats instants as datetime-local wall clocks in the target timezone", () => {
    expect(civilDateTimeString(new Date("2025-08-12T18:00:00.000Z"), "UTC")).toBe("2025-08-12T18:00");
    expect(civilDateTimeString(new Date("2025-08-12T18:00:00.000Z"), "America/Los_Angeles")).toBe("2025-08-12T11:00"); // UTC-7 (PDT)
    expect(civilDateTimeString(new Date("2025-08-12T18:00:00.000Z"), "Asia/Tokyo")).toBe("2025-08-13T03:00"); // UTC+9
    expect(civilDateTimeString(new Date("2025-01-15T00:30:00.000Z"), "America/New_York")).toBe("2025-01-14T19:30"); // UTC-5 (EST)
  });

  it("round-trips datetime-local values through the form's timezone", () => {
    const tz = "America/Los_Angeles";
    const parts = parseCivilDateTime("2025-08-12T18:00")!;
    expect(parts).toEqual({ year: 2025, month: 8, day: 12, hour: 18, minute: 0, second: 0 });
    const instant = instantFromCivil(tz, parts);
    expect(instant.toISOString()).toBe("2025-08-13T01:00:00.000Z"); // 18:00 PDT
    expect(civilDateTimeString(instant, tz)).toBe("2025-08-12T18:00");
  });

  it("rejects malformed datetime-local values", () => {
    expect(parseCivilDateTime("")).toBeNull();
    expect(parseCivilDateTime("2025-08-12 18:00")).toBeNull(); // space, not T
    expect(parseCivilDateTime("2025-08-12T18:00:00")).toBeNull(); // seconds not allowed
    expect(parseCivilDateTime("2025-08-12T24:00")).toBeNull();
    expect(parseCivilDateTime("2025-08-12T18:60")).toBeNull();
    expect(parseCivilDateTime("2025-02-31T18:00")).toBeNull(); // nonexistent date
  });
});
