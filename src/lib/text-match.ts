/**
 * Compiles a case-insensitive whole-word matcher for `needle`, escaping
 * regex metacharacters. Exposed separately from wordBoundaryMatch so
 * callers checking the same needle against many haystacks (e.g. one
 * player's name against every article in the pool) can compile once and
 * reuse the pattern instead of rebuilding a RegExp per comparison.
 *
 * `flags` defaults to a plain case-insensitive match. Pass `'gi'` when the
 * pattern is for `String.replace` rather than `test` — team-mentions.ts
 * masks each name it finds so a shorter one nested inside it ("Michigan"
 * inside "Michigan State") can't match the same text twice. Don't pass
 * `'g'` to something that calls `test`: that form is stateful.
 */
export function compileWordBoundary(needle: string, flags = 'i'): RegExp {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, flags);
}

/** Case-insensitive whole-word match, escaping regex metacharacters in `needle`. */
export function wordBoundaryMatch(haystack: string, needle: string): boolean {
  return compileWordBoundary(needle).test(haystack);
}
