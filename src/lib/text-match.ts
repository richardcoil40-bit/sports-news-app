/**
 * Compiles a case-insensitive whole-word matcher for `needle`, escaping
 * regex metacharacters. Exposed separately from wordBoundaryMatch so
 * callers checking the same needle against many haystacks (e.g. one
 * player's name against every article in the pool) can compile once and
 * reuse the pattern instead of rebuilding a RegExp per comparison.
 */
export function compileWordBoundary(needle: string): RegExp {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

/** Case-insensitive whole-word match, escaping regex metacharacters in `needle`. */
export function wordBoundaryMatch(haystack: string, needle: string): boolean {
  return compileWordBoundary(needle).test(haystack);
}
