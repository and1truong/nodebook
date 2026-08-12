/**
 * RFC 5545 recurrence rules — the subset NodeBook supports: FREQ
 * (DAILY|WEEKLY|MONTHLY), INTERVAL, BYDAY (DAILY/WEEKLY only), COUNT, and
 * UNTIL. Pure Web Platform math via Intl timezones (see shared/time.ts).
 */
import { instantFromCivil, civilFromInstant, civilDateString, daysInMonth, isValidTimezone, parseCivilDate } from "./time";
import { ValidationError } from "../domain/errors";

export type RecurrenceFreq = "DAILY" | "WEEKLY" | "MONTHLY";

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  interval: number;
  /** Weekday names ("MO".."SU"); empty means "same weekday as the anchor". */
  byDay: string[];
  /** Total number of occurrences, including the anchor occurrence. */
  count?: number;
  /** Inclusive upper bound on occurrence instants. */
  until?: string;
}

const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
// Offset from a Monday week start: MO=0 … SU=6 (chronological).
const DAY_INDEX: Record<string, number> = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };
const WEEKDAY_BY_INDEX = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function isWeekday(value: string): value is (typeof WEEKDAYS)[number] {
  return WEEKDAYS.includes(value as (typeof WEEKDAYS)[number]);
}

export function weekdayOfDate(civilDate: string): string {
  const d = parseCivilDate(civilDate);
  if (!d) throw new ValidationError(`Invalid civil date: ${civilDate}`);
  const epoch = Date.UTC(d.year, d.month - 1, d.day);
  return WEEKDAY_BY_INDEX[new Date(epoch).getUTCDay()]!;
}

export function parseRecurrenceRule(text: string): RecurrenceRule {
  if (!text || text.length > 500) throw new ValidationError("Invalid recurrence rule");
  const rule: RecurrenceRule = { freq: "DAILY", interval: 1, byDay: [] };
  for (const part of text.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) throw new ValidationError(`Invalid recurrence rule part: "${part}"`);
    const key = part.slice(0, eq).trim().toUpperCase();
    const value = part.slice(eq + 1).trim();
    switch (key) {
      case "FREQ": {
        if (value !== "DAILY" && value !== "WEEKLY" && value !== "MONTHLY") {
          throw new ValidationError(`Unsupported FREQ: ${value} (only DAILY, WEEKLY, MONTHLY are supported)`);
        }
        rule.freq = value;
        break;
      }
      case "INTERVAL": {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 99) throw new ValidationError("INTERVAL must be an integer between 1 and 99");
        rule.interval = n;
        break;
      }
      case "BYDAY": {
        if (!value) throw new ValidationError("BYDAY requires at least one weekday");
        const days = value.split(",").map((s) => s.trim().toUpperCase());
        for (const day of days) {
          // Ordinal forms like "1MO" are out of scope for the MVP.
          if (!isWeekday(day)) throw new ValidationError(`Unsupported BYDAY value: ${day}`);
        }
        rule.byDay = days;
        break;
      }
      case "COUNT": {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 100_000) throw new ValidationError("COUNT must be an integer >= 1");
        rule.count = n;
        break;
      }
      case "UNTIL": {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) throw new ValidationError(`Invalid UNTIL value: ${value}`);
        rule.until = d.toISOString();
        break;
      }
      default:
        throw new ValidationError(`Unsupported recurrence rule part: ${key}`);
    }
  }
  if (rule.freq === "MONTHLY" && rule.byDay.length > 0) {
    throw new ValidationError("BYDAY is not supported for MONTHLY recurrence in NodeBook");
  }
  if (rule.count !== undefined && rule.until !== undefined) {
    throw new ValidationError("COUNT and UNTIL cannot both be set");
  }
  return rule;
}

export function serializeRecurrenceRule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.freq}`, `INTERVAL=${rule.interval}`];
  if (rule.byDay.length > 0) parts.push(`BYDAY=${rule.byDay.join(",")}`);
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
  if (rule.until !== undefined) parts.push(`UNTIL=${rule.until}`);
  return parts.join(";");
}

export interface RecurrenceRuleInput {
  freq: RecurrenceFreq;
  interval?: number;
  byDay?: string[];
  count?: number;
  until?: string;
}

export function buildRecurrenceRule(input: RecurrenceRuleInput): RecurrenceRule {
  const rule: RecurrenceRule = { freq: input.freq, interval: input.interval ?? 1, byDay: input.byDay ?? [] };
  if (input.count !== undefined) rule.count = input.count;
  if (input.until !== undefined) rule.until = input.until;
  return rule;
}

export function isRecurrenceRuleText(text: string | null | undefined): text is string {
  if (!text) return false;
  try {
    parseRecurrenceRule(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compute the next occurrence strictly after `after`, advancing from `anchor`
 * (the first occurrence; defaults to `after`). The anchor's day-of-month is
 * preserved for MONTHLY rules (clamped to month length); the anchor's weekday
 * is the default for WEEKLY rules when BYDAY is absent. The time of day of the
 * previous occurrence is preserved. Returns null when COUNT or UNTIL
 * terminates the series. `initialOrdinal` counts occurrences already consumed
 * (e.g. recorded completions) so COUNT is enforced across repeated calls.
 */
export function nextOccurrence(
  rule: RecurrenceRule,
  timezone: string,
  after: Date,
  anchor: Date = after,
  initialOrdinal = 1,
): Date | null {
  if (!isValidTimezone(timezone)) throw new ValidationError(`Invalid timezone: ${timezone}`);
  const anchorCivil = civilFromInstant(anchor, timezone);
  let current = anchor;
  let ordinal = initialOrdinal;
  let guard = 0;
  const maxIterations = 10_000;

  while (current.getTime() <= after.getTime()) {
    const next = advance(rule, timezone, current, anchorCivil);
    if (!next) return null;
    current = next;
    ordinal += 1;
    if (rule.count !== undefined && ordinal > rule.count) return null;
    if (rule.until !== undefined && current.getTime() > new Date(rule.until).getTime()) return null;
    if (++guard > maxIterations) return null;
  }
  return current;
}

function advance(rule: RecurrenceRule, timezone: string, current: Date, anchorCivil: ReturnType<typeof civilFromInstant>): Date | null {
  const cur = civilFromInstant(current, timezone);
  switch (rule.freq) {
    case "DAILY": {
      const next = { ...cur, day: cur.day + rule.interval };
      return instantFromCivil(timezone, next);
    }
    case "WEEKLY": {
      const byDay = [...(rule.byDay.length > 0 ? rule.byDay : [weekdayName(anchorCivil)])].sort(
        (a, b) => DAY_INDEX[a]! - DAY_INDEX[b]!,
      );
      const anchorWeekStart = mondayOf(anchorCivil);
      // Candidate weeks start at the anchor week; step by interval weeks.
      let weekOffset = 0;
      for (;;) {
        const weekStart = addDaysCivil(anchorWeekStart, (weekOffset * rule.interval) * 7);
        for (const day of byDay) {
          const dayOffset = DAY_INDEX[day]!;
          const candidate = instantFromCivil(timezone, {
            ...anchorCivil,
            year: weekStart.year,
            month: weekStart.month,
            day: weekStart.day + dayOffset,
          });
          if (candidate.getTime() > current.getTime()) return candidate;
        }
        weekOffset += 1;
        if (weekOffset > 10_000) return null;
      }
    }
    case "MONTHLY": {
      const monthIndex = cur.year * 12 + (cur.month - 1) + rule.interval;
      const year = Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      const day = Math.min(anchorCivil.day, daysInMonth(year, month));
      const candidate = instantFromCivil(timezone, { ...cur, year, month, day });
      if (candidate.getTime() > current.getTime()) return candidate;
      return null;
    }
  }
}

function weekdayName(civil: { year: number; month: number; day: number }): string {
  const epoch = Date.UTC(civil.year, civil.month - 1, civil.day);
  return WEEKDAY_BY_INDEX[new Date(epoch).getUTCDay()]!;
}

function mondayOf(civil: { year: number; month: number; day: number }): { year: number; month: number; day: number } {
  const epoch = Date.UTC(civil.year, civil.month - 1, civil.day);
  const day = new Date(epoch).getUTCDay(); // 0=Sun
  const offset = day === 0 ? -6 : 1 - day;
  return addDaysCivil(civil, offset);
}

function addDaysCivil(civil: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const epoch = Date.UTC(civil.year, civil.month - 1, civil.day) + days * 86_400_000;
  const d = new Date(epoch);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Convenience for recurring issue completion: next due civil date in tz. */
export function nextCivilDate(rule: RecurrenceRule, timezone: string, after: Date, anchor: Date): string | null {
  const next = nextOccurrence(rule, timezone, after, anchor);
  if (!next) return null;
  return civilDateString(next, timezone);
}
