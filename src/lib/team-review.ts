import { teamSlug } from '@/lib/team-slug';

/**
 * Whether a hand-curated per-team table has been *ruled on* for a team.
 *
 * community-sources.ts and team-nicknames.ts both used to answer `[]` to
 * two different questions: "researched, there is nothing worth adding" and
 * "nobody has ever looked". At 34 teams the difference is visible by
 * reading the file. At 900 it isn't, and a league ships with neither its
 * names nor its sources reviewed while every lookup returns a
 * plausible-looking empty list — the same failure the feed layer already
 * refuses to make, where a quiet publisher and an unparseable one are
 * deliberately not the same state.
 *
 * So the convention changes and the shape doesn't:
 *
 * - **Key present** — reviewed. `[]` means deliberately nothing.
 * - **Key absent** — not reviewed.
 *
 * The lookups still read `table[slug] ?? []`, so nothing about what the
 * app fetches changes. This is a second question asked of the same tables,
 * and the tables stay the source of truth for the first one.
 *
 * Shared here for the reason team-slug.ts is shared: two tables answering
 * the same question two ways is how they stop agreeing.
 */
export interface ReviewState {
  /** Whether anyone has ruled on this team. */
  reviewed: boolean;
  /**
   * What was ruled out and why, where that was worth recording — a dead
   * newspaper chain, a nickname no school can claim. Required for a
   * reviewed team with an empty entry; also carried by a team with a
   * *partial* entry, which is most of the value here ("has a blog, its
   * metro paper is Gannett" is what stops Gannett being re-verified once
   * per team it owns). `null` when there was nothing to say.
   */
  reason: string | null;
}

export interface TeamReview {
  /** The review state for a team, by the short name ESPN returns. */
  reviewFor: (teamShortName: string) => ReviewState;
  /**
   * Authoring mistakes in the table/reasons pair: an empty entry with no
   * reason, or a reason for a team the table never mentions. Both are
   * invisible at every call site — an orphaned reason reads as research
   * that is still in force when it has actually drifted off its entry — so
   * a test asserts this comes back empty rather than a reader noticing.
   */
  issues: () => string[];
}

/**
 * Pairs a curated table with the table of why its gaps are gaps. Neither
 * moves out of the file that owns it; only the reading of them lives here.
 */
export function createTeamReview(
  table: Record<string, readonly unknown[]>,
  reasons: Record<string, string>,
): TeamReview {
  return {
    reviewFor(teamShortName: string): ReviewState {
      const slug = teamSlug(teamShortName);
      if (table[slug] === undefined) return { reviewed: false, reason: null };
      return { reviewed: true, reason: reasons[slug] ?? null };
    },
    issues(): string[] {
      const found: string[] = [];
      for (const [slug, entries] of Object.entries(table)) {
        if (entries.length === 0 && !reasons[slug]) {
          found.push(`${slug}: reviewed with nothing, but no reason recorded`);
        }
      }
      for (const slug of Object.keys(reasons)) {
        if (table[slug] === undefined) {
          found.push(`${slug}: has a reason, but no entry in the table`);
        }
      }
      return found;
    },
  };
}
