/**
 * Wall-clock conversions for the household's time zone. Everything stored is UTC; every rule about
 * "which day" or "what time of day" is local. These three functions are the only place that
 * conversion happens, so a DST boundary is handled once instead of once per caller.
 *
 * This replaced three copies (`briefing-service.ts`, `job-scheduler.ts`, and a hardcoded `-04:00`
 * in `recurrence-service.ts`). The hardcoded one was a real bug: it silently shifted every routine's
 * day window by an hour for the five months of the year that are EST.
 */
export const HOME_TIME_ZONE = "America/New_York";

const DAY_MS = 24 * 60 * 60 * 1000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Offset (ms) of `timeZone` from UTC at `instant`; positive east of Greenwich. */
export function zoneOffsetMs(instant: Date, timeZone: string = HOME_TIME_ZONE): number {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) parts[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  // Drop milliseconds so the offset is a whole number of seconds and pinned times land exactly.
  return asUtc - (instant.getTime() - instant.getMilliseconds());
}

/** `YYYY-MM-DD` of the local day `instant` falls on. */
export function localDate(instant: Date, timeZone: string = HOME_TIME_ZONE): string {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** The UTC instant of local midnight for a `YYYY-MM-DD` date. */
export function startOfLocalDay(date: string, timeZone: string = HOME_TIME_ZONE): Date {
  const wall = new Date(`${date}T00:00:00Z`);
  return new Date(wall.getTime() - zoneOffsetMs(wall, timeZone));
}

/**
 * The UTC instant of a local wall-clock time on a `YYYY-MM-DD` date. Converts twice because the
 * offset at the naive guess can differ from the offset at the answer (either side of a DST change).
 */
export function localInstant(date: string, hour: number, minute: number = 0, timeZone: string = HOME_TIME_ZONE): Date {
  const wall = Date.UTC(
    Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hour, minute,
  );
  const guess = wall - zoneOffsetMs(new Date(wall), timeZone);
  return new Date(wall - zoneOffsetMs(new Date(guess), timeZone));
}

/** Shift a `YYYY-MM-DD` date by whole days. */
export function addDays(date: string, count: number): string {
  const base = new Date(`${date}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + count);
  return base.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / DAY_MS);
}

/** `getDay()` index (0 = Sunday) of a `YYYY-MM-DD` date, without a zone shift. */
export function weekdayIndex(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export { DAY_MS };
