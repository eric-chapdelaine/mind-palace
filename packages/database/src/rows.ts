export type Row = Record<string, unknown>;

export function row(value: unknown, context: string): Row {
  if (!value || typeof value !== "object") {
    throw new Error(`Expected database row for ${context}`);
  }
  return value as Row;
}

export function text(value: unknown): string {
  return String(value);
}

export function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function integer(value: unknown): number {
  return Number(value);
}

export function boolean(value: unknown): boolean {
  return Number(value) === 1;
}

export function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  return JSON.parse(String(value)) as T;
}
