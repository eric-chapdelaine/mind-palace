/**
 * Shared request coercion for the route layer. These are deliberately generic: they validate
 * primitive shapes and throw plain `Error`s (the app's `onError` turns them into a 400 body).
 * Domain-specific parsing (rules, imports) lives next to its domain.
 */

export function numberParam(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

/** Optional user text: absent → undefined (leave unchanged), null/blank → null (clear), else trimmed. */
export function optionalText(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return value.trim() || null;
}

export function isTimeBlockBody(value: unknown): value is { startAt: string; endAt: string; type?: string; notes?: string } {
  return typeof value === "object" && value !== null && "startAt" in value && "endAt" in value;
}
