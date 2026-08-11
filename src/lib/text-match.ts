/** Case-insensitive whole-word match, escaping regex metacharacters in `needle`. */
export function wordBoundaryMatch(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack);
}
