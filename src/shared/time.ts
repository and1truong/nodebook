/**
 * Civil-time (wall clock) helpers for IANA timezones, implemented on
 * Intl.DateTimeFormat only — no Node APIs, so this runs identically on the
 * Worker, in MCP tool handlers, and in the browser.
 */

export interface CivilParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function civilFormatter(timezone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timezone, fmt);
  }
  return fmt;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    civilFormatter(timezone);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock reading of `instant` in `timezone`. */
export function civilFromInstant(instant: Date, timezone: string): CivilParts {
  const parts = civilFormatter(timezone).formatToParts(instant);
  const get = (type: string): number => {
    const p = parts.find((part) => part.type === type);
    return p ? Number(p.value) : 0;
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** UTC offset (minutes east of UTC) in effect at `instant` in `timezone`. */
export function utcOffsetMinutes(instant: Date, timezone: string): number {
  const c = civilFromInstant(instant, timezone);
  const civilEpoch = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  return Math.round((civilEpoch - instant.getTime()) / 60_000);
}

/**
 * Convert a wall-clock reading in `timezone` to an instant. Deterministic under
 * DST transitions:
 *  - Ambiguous times (fall-back overlap) resolve to the first occurrence.
 *  - Nonexistent times (spring-forward gap) resolve to the instant the clock
 *    first reaches (i.e. the post-transition offset is applied).
 */
export function instantFromCivil(timezone: string, c: CivilParts): Date {
  const naive = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  let epoch = naive;
  for (let i = 0; i < 3; i++) {
    const offset = utcOffsetMinutes(new Date(epoch), timezone);
    const candidate = naive - offset * 60_000;
    if (candidate === epoch) break;
    epoch = candidate;
  }
  return new Date(epoch);
}

export function civilDateString(instant: Date, timezone: string): string {
  const c = civilFromInstant(instant, timezone);
  return `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}`;
}

/** Number of days in `month` (1-12) of `year` (proleptic Gregorian). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseCivilDate(value: string): CivilParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day, hour: 0, minute: 0, second: 0 };
}

/**
 * Civil datetime (YYYY-MM-DDTHH:mm) of `instant` in `timezone` — the value
 * shape of a `<input type="datetime-local">`. Fill inputs with this so the
 * stored UTC instant is shown as the wall clock of the intended timezone.
 */
export function civilDateTimeString(instant: Date, timezone: string): string {
  const c = civilFromInstant(instant, timezone);
  return `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}T${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}`;
}

/** Parse a datetime-local value (YYYY-MM-DDTHH:mm) into civil parts; null if malformed. */
export function parseCivilDateTime(value: string): CivilParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const date = parseCivilDate(`${m[1]}-${m[2]}-${m[3]}`);
  if (!date) return null;
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (hour > 23 || minute > 59) return null;
  return { ...date, hour, minute };
}

/** Civil date (YYYY-MM-DD) of `instant` in `timezone`. */
export function todayCivil(instant: Date, timezone: string): string {
  return civilDateString(instant, timezone);
}

/** [start, end) instants of the civil day `dateStr` (YYYY-MM-DD) in `timezone`. */
export function dayRange(dateStr: string, timezone: string): [Date, Date] {
  const d = parseCivilDate(dateStr);
  if (!d) throw new Error(`Invalid civil date: ${dateStr}`);
  const start = instantFromCivil(timezone, d);
  const end = instantFromCivil(timezone, { ...d, day: d.day + 1 });
  return [start, end];
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const da = Date.UTC(ay!, am! - 1, ad!);
  const db = Date.UTC(by!, bm! - 1, bd!);
  return Math.round((db - da) / 86_400_000);
}

/** ISO instant (UTC) for "now". */
export function nowIso(): string {
  return new Date().toISOString();
}
