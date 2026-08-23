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
  // The Big 12 brought three more of ESPN's "St" abbreviations. They expand
  // the same way the Big Ten's do, and they are here rather than left alone
  // for the same reason: a table keyed on `arizona-st` beside one keyed on
  // `michigan-state` is two conventions for one thing, and the second league
  // to add an "St" school is exactly when that starts.
  'arizona-st': 'arizona-state',
  'kansas-st': 'kansas-state',
  'oklahoma-st': 'oklahoma-state',
  'michigan-st': 'michigan-state',
  'mississippi-st': 'mississippi-state',
  'ohio-st': 'ohio-state',
  'penn-st': 'penn-state',
  // Not 'washington': the other aliases expand an abbreviation to the same
  // school, and this one used to resolve to a different one — Washington
  // State inheriting Washington's nicknames and the Seattle Times. Latent,
  // since neither shipped league has Washington State, and invisible at
  // every call site because the wrong answer is a plausible one.
  'washington-st': 'washington-state',
  // Not an ESPN abbreviation like the rest — "Texas A&M" is already how the
  // school is written. The ampersand is what the slugifier above collapses,
  // and `texas-a-m` as a table key reads like a typo of one.
  'texas-a-m': 'texas-am',
};

/**
 * Whether an alias *shortens* a name rather than expanding one.
 *
 * Every alias here exists to turn ESPN's abbreviation into the way a
 * school is normally written, which always adds information:
 * `michigan-st` → `michigan-state`. An alias that drops a word does the
 * opposite and lands on a *different school* — `washington-st` →
 * `washington` did exactly that, and would have served Washington State
 * the Huskies, the Seattle Times and UW Dawg Pound with nothing on the
 * screen looking wrong.
 *
 * Word-wise rather than by string prefix, so `texas-a-m` → `texas-am`
 * (which collapses punctuation rather than dropping a word) doesn't trip
 * it.
 */
function dropsAWord(from: string, to: string): boolean {
  const fromWords = from.split('-');
  const toWords = to.split('-');
  return toWords.length < fromWords.length && toWords.every((word, i) => word === fromWords[i]);
}

/**
 * The warning for one team's alias, or null if there's nothing to say.
 * Printed per team by scripts/review/propose.mjs.
 */
export function aliasWarningFor(teamShortName: string): string | null {
  const raw = rawTeamSlug(teamShortName);
  const resolved = SLUG_ALIASES[raw];
  if (!resolved || !dropsAWord(raw, resolved)) return null;
  return `"${raw}" resolves to "${resolved}", which drops a word and so names a different school`;
}

/**
 * Every alias that shortens rather than expands. Empty in a healthy table
 * — team-review.test.ts asserts that, because this is the one defect in
 * this file that produces a plausible wrong answer rather than an obvious
 * one, and it stays latent until a league that has the affected school
 * ships.
 */
export function aliasIssues(): string[] {
  return Object.entries(SLUG_ALIASES)
    .filter(([from, to]) => dropsAWord(from, to))
    .map(([from, to]) => `${from} -> ${to}: the alias drops a word, so it names a different school`);
}

/**
 * The slug before aliases — lowercased and punctuation-collapsed, and
 * nothing else.
 *
 * Exported for one caller: scripts/review/propose.mjs prints "aliased to
 * X" on a team's worksheet block, which needs both halves of the answer —
 * whether an alias fired at all is the difference between the two. Whether
 * that alias is *wrong* is `aliasWarningFor` above, deliberately here
 * rather than in the script, so the worksheet and the gate can't hold two
 * opinions about one table.
 */
export function rawTeamSlug(teamShortName: string): string {
  return String(teamShortName ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Lowercased, punctuation-collapsed, and resolved through the aliases. */
export function teamSlug(teamShortName: string): string {
  const slug = rawTeamSlug(teamShortName);
  return SLUG_ALIASES[slug] ?? slug;
}
