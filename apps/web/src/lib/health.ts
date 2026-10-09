/** Formatting helpers shared by the schedule and the health detail pages. */

/** Compact "7h 30m" / "45m" label; empty only when the value is unknown (0 is meaningful, e.g. awake time). */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return "";
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
}

/** Local clock time like "11:06 PM". */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Wall-clock length of a window in minutes (the calendar block's true size). */
export function elapsedMinutes(startAt: string, endAt: string): number {
  return (new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000;
}

/** "6.4 km" / "820 m"; empty when unknown. */
export function formatDistance(meters: number | null): string {
  if (meters === null || meters <= 0) return "";
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

/** Local calendar date like "Wed, Oct 8, 2026". */
export function formatDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
