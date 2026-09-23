/**
 * Readers for untrusted JSON, shared by the scoreboard and game-summary
 * parsers. Each returns the value only if it is the type the caller needs,
 * so a field ESPN changed the type of degrades to absent instead of
 * flowing through as the wrong thing — the "defensive parsing" rule in
 * AGENTS.md, as three functions rather than a `?.` chain per field.
 */

export function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** A finite number, including one ESPN sent as a string (`"score": "21"`). */
export function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
