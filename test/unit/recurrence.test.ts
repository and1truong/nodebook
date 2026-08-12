import { describe, expect, it } from "vitest";
import {
  buildRecurrenceRule,
  nextOccurrence,
  parseRecurrenceRule,
  serializeRecurrenceRule,
} from "../../src/shared/recurrence";
import { ValidationError } from "../../src/domain/errors";
import { instantFromCivil } from "../../src/shared/time";

function civil(tz: string, iso: string): Date {
  return new Date(iso);
}

describe("parseRecurrenceRule", () => {
  it("parses daily/weekly/monthly with interval", () => {
    expect(parseRecurrenceRule("FREQ=DAILY;INTERVAL=2")).toEqual({ freq: "DAILY", interval: 2, byDay: [] });
    expect(parseRecurrenceRule("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE")).toEqual({
      freq: "WEEKLY",
      interval: 1,
      byDay: ["MO", "WE"],
    });
    expect(parseRecurrenceRule("FREQ=MONTHLY;INTERVAL=1")).toEqual({ freq: "MONTHLY", interval: 1, byDay: [] });
  });

  it("parses COUNT and UNTIL", () => {
    const rule = parseRecurrenceRule("FREQ=DAILY;COUNT=5");
    expect(rule.count).toBe(5);
    const until = parseRecurrenceRule("FREQ=DAILY;UNTIL=2025-12-31T00:00:00.000Z");
    expect(until.until).toBe("2025-12-31T00:00:00.000Z");
  });

  it("rejects unsupported or malformed rules", () => {
    expect(() => parseRecurrenceRule("FREQ=YEARLY")).toThrow(ValidationError);
    expect(() => parseRecurrenceRule("FREQ=DAILY;INTERVAL=0")).toThrow(ValidationError);
    expect(() => parseRecurrenceRule("FREQ=DAILY;BYDAY=1MO")).toThrow(ValidationError);
    expect(() => parseRecurrenceRule("FREQ=MONTHLY;BYDAY=MO")).toThrow(ValidationError);
    expect(() => parseRecurrenceRule("FREQ=DAILY;COUNT=5;UNTIL=2025-01-01")).toThrow(ValidationError);
    expect(() => parseRecurrenceRule("FREQ=DAILY;WHATEVER=1")).toThrow(ValidationError);
    expect(() => parseRecurrenceRule("garbage")).toThrow(ValidationError);
  });

  it("round-trips through serialize", () => {
    const rule = buildRecurrenceRule({ freq: "WEEKLY", interval: 2, byDay: ["MO", "FR"] });
    expect(serializeRecurrenceRule(rule)).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR");
  });
});

describe("nextOccurrence", () => {
  it("advances daily by interval", () => {
    const rule = parseRecurrenceRule("FREQ=DAILY;INTERVAL=1");
    const anchor = civil("UTC", "2025-01-01T09:00:00.000Z");
    const next = nextOccurrence(rule, "UTC", anchor, anchor)!;
    expect(next.toISOString()).toBe("2025-01-02T09:00:00.000Z");
  });

  it("returns the first occurrence strictly after `after`", () => {
    const rule = parseRecurrenceRule("FREQ=DAILY;INTERVAL=1");
    const anchor = civil("UTC", "2025-01-01T09:00:00.000Z");
    const next = nextOccurrence(rule, "UTC", civil("UTC", "2025-01-05T10:00:00.000Z"), anchor)!;
    expect(next.toISOString()).toBe("2025-01-06T09:00:00.000Z");
  });

  it("honors COUNT", () => {
    const rule = parseRecurrenceRule("FREQ=DAILY;COUNT=3");
    const anchor = civil("UTC", "2025-01-01T09:00:00.000Z");
    // Occurrence 3 is 01-03; occurrence 4 would exceed COUNT → null.
    const next = nextOccurrence(rule, "UTC", civil("UTC", "2025-01-03T09:00:00.000Z"), anchor);
    expect(next).toBeNull();
    const second = nextOccurrence(rule, "UTC", civil("UTC", "2025-01-02T09:00:00.000Z"), anchor);
    expect(second!.toISOString()).toBe("2025-01-03T09:00:00.000Z");
  });

  it("honors UNTIL (inclusive)", () => {
    const rule = parseRecurrenceRule("FREQ=DAILY;UNTIL=2025-01-05T09:00:00.000Z");
    const anchor = civil("UTC", "2025-01-01T09:00:00.000Z");
    expect(nextOccurrence(rule, "UTC", civil("UTC", "2025-01-05T08:00:00.000Z"), anchor)!.toISOString()).toBe(
      "2025-01-05T09:00:00.000Z",
    );
    expect(nextOccurrence(rule, "UTC", civil("UTC", "2025-01-05T09:00:00.000Z"), anchor)).toBeNull();
  });

  it("advances weekly on the same weekday by default", () => {
    const rule = parseRecurrenceRule("FREQ=WEEKLY;INTERVAL=1");
    const anchor = civil("UTC", "2025-03-03T10:00:00.000Z"); // Monday
    const next = nextOccurrence(rule, "UTC", anchor, anchor)!;
    expect(next.toISOString()).toBe("2025-03-10T10:00:00.000Z");
  });

  it("advances weekly to the next BYDAY day", () => {
    const rule = parseRecurrenceRule("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR");
    const anchor = civil("UTC", "2025-03-03T10:00:00.000Z"); // Monday
    const tue = civil("UTC", "2025-03-04T10:00:00.000Z");
    const next = nextOccurrence(rule, "UTC", tue, anchor)!;
    expect(next.toISOString()).toBe("2025-03-05T10:00:00.000Z"); // Wednesday
  });

  it("includes Sunday when BYDAY spans the weekend (MO,SU)", () => {
    const rule = parseRecurrenceRule("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,SU");
    const anchor = civil("UTC", "2025-03-03T10:00:00.000Z"); // Monday
    // Completing Monday's occurrence → Sunday of the same week, not next Monday.
    const sunday = nextOccurrence(rule, "UTC", anchor, anchor)!;
    expect(sunday.toISOString()).toBe("2025-03-09T10:00:00.000Z");
    // Completing Sunday's occurrence → next Monday.
    const monday = nextOccurrence(rule, "UTC", sunday, anchor)!;
    expect(monday.toISOString()).toBe("2025-03-10T10:00:00.000Z");
    // And BYDAY=SU,MO (reversed rule text) behaves identically.
    const reversed = parseRecurrenceRule("FREQ=WEEKLY;INTERVAL=1;BYDAY=SU,MO");
    const sunday2 = nextOccurrence(reversed, "UTC", anchor, anchor)!;
    expect(sunday2.toISOString()).toBe("2025-03-09T10:00:00.000Z");
  });

  it("handles BYDAY=SA,SU across a week boundary", () => {
    const rule = parseRecurrenceRule("FREQ=WEEKLY;INTERVAL=1;BYDAY=SA,SU");
    const anchor = civil("UTC", "2025-03-03T10:00:00.000Z"); // Monday
    const saturday = nextOccurrence(rule, "UTC", anchor, anchor)!;
    expect(saturday.toISOString()).toBe("2025-03-08T10:00:00.000Z");
    const sunday = nextOccurrence(rule, "UTC", saturday, anchor)!;
    expect(sunday.toISOString()).toBe("2025-03-09T10:00:00.000Z");
  });

  it("advances monthly clamping to month length", () => {
    const rule = parseRecurrenceRule("FREQ=MONTHLY;INTERVAL=1");
    const anchor = civil("UTC", "2025-01-31T09:00:00.000Z");
    const next = nextOccurrence(rule, "UTC", anchor, anchor)!;
    expect(next.toISOString()).toBe("2025-02-28T09:00:00.000Z");
    const mar = nextOccurrence(rule, "UTC", next, anchor)!;
    expect(mar.toISOString()).toBe("2025-03-31T09:00:00.000Z");
  });

  it("handles DST transitions deterministically (America/New_York)", () => {
    // Spring forward: 2025-03-09 02:00 does not exist.
    const rule = parseRecurrenceRule("FREQ=DAILY;INTERVAL=1");
    const anchor = instantFromCivil("America/New_York", { year: 2025, month: 3, day: 8, hour: 9, minute: 0, second: 0 });
    const next = nextOccurrence(rule, "America/New_York", anchor, anchor)!;
    const civilNext = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(next);
    expect(civilNext).toBe("09:00");
    // Exactly 24h of wall-clock later; instant delta is 23h across the gap.
    expect(next.getTime() - anchor.getTime()).toBe(23 * 3600_000);
  });

  it("handles fall-back overlap deterministically (America/New_York)", () => {
    const rule = parseRecurrenceRule("FREQ=DAILY;INTERVAL=1");
    const anchor = instantFromCivil("America/New_York", { year: 2025, month: 11, day: 1, hour: 9, minute: 0, second: 0 });
    const next = nextOccurrence(rule, "America/New_York", anchor, anchor)!;
    expect(next.getTime() - anchor.getTime()).toBe(25 * 3600_000); // 25h wall clock across fall-back
  });

  it("preserves time of day across weekly/monthly advances", () => {
    const rule = parseRecurrenceRule("FREQ=WEEKLY;INTERVAL=1");
    const anchor = civil("UTC", "2025-03-03T08:30:00.000Z");
    const next = nextOccurrence(rule, "UTC", anchor, anchor)!;
    expect(next.getUTCHours()).toBe(8);
    expect(next.getUTCMinutes()).toBe(30);
  });

  it("rejects invalid timezones", () => {
    const rule = parseRecurrenceRule("FREQ=DAILY");
    expect(() => nextOccurrence(rule, "Not/AZone", new Date())).toThrow(ValidationError);
  });
});
