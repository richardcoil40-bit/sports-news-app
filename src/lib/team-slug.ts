/**
 * The key hand-curated per-team tables are looked up by.
 *
 * ESPN's short names don't always match how a school is normally written
 * ("Michigan St", not "Michigan State"), so lookups go through a slug plus
 * an alias table rather than depending on an exact string. Extracted here
 * once two tables needed it — community-sources.ts and team-nicknames.ts
 * must agree on what "Michigan St" is called, and two copies of an alias
 * table is exactly how they'd stop agreeing.
 */
const SLUG_ALIASES: Record<string, string> = {
  'michigan-st': 'michigan-state',
  'mississippi-st': 'mississippi-state',
  'ohio-st': 'ohio-state',
  'penn-st': 'penn-state',
  'washington-st': 'washington',
  // Not an ESPN abbreviation like the rest — "Texas A&M" is already how the
  // school is written. The ampersand is what the slugifier above collapses,
  // and `texas-a-m` as a table key reads like a typo of one.
  'texas-a-m': 'texas-am',
};

/** Lowercased, punctuation-collapsed, and resolved through the aliases. */
export function teamSlug(teamShortName: string): string {
  const slug = String(teamShortName ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return SLUG_ALIASES[slug] ?? slug;
}
