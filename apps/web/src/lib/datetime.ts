/**
 * The API speaks ISO instants; `<input type="datetime-local">` speaks local wall time without a
 * zone. Both directions live here so the conversion is written once.
 */

/** ISO instant → the `YYYY-MM-DDTHH:MM` string a `datetime-local` input wants. */
export function toLocalDateTimeInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `datetime-local` value → ISO instant, or null when the field is empty. */
export function toIsoInstant(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

/** Today's local calendar date as `YYYY-MM-DD`, which is what a date input and the API both want. */
export function todayLocalDate(): string {
  return toLocalDateTimeInput(new Date().toISOString()).slice(0, 10);
}
