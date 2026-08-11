import { Article } from '@/lib/feeds';
import { Player } from '@/lib/roster';
import { StatLeader } from '@/lib/team-leaders';
import { compileWordBoundary } from '@/lib/text-match';

export interface RankedPlayer {
  player: Player;
  /** Number of articles in the pool that name this player. */
  mentions: number;
  score: number;
  /** Short explanation of why they're on the list, shown in the UI. */
  detail: string;
}

const FULL_NAME_POINTS = 3;
const LAST_NAME_POINTS = 1;

/** Short surnames produce too many false hits to be worth matching alone. */
const MIN_LAST_NAME_LENGTH = 5;

/**
 * Suffixes and trailing periods break word-boundary matching ("Jr." ends in a
 * non-word character, so a trailing \b can never match), so names are trimmed
 * to a form that matches how articles actually write them.
 */
function normalizeName(name: string): string {
  return name.replace(/\.+$/, '').trim();
}

function countLastNames(roster: Player[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const player of roster) {
    const key = player.lastName.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Ranks a roster by how much a player is actually being written about, which
 * is a far better proxy for "notable" than anything the roster itself
 * contains — ESPN publishes no depth chart in the offseason, and sorting by
 * class or jersey number surfaces walk-ons as readily as starters.
 *
 * Article mentions are the primary signal. Last season's statistical leaders
 * are a secondary one, because coverage volume is thin in the offseason and
 * a returning 1,000-yard rusher is notable whether or not anyone wrote about
 * him this week.
 */
export function rankNotablePlayers(
  roster: Player[],
  articles: Article[],
  leaders: StatLeader[] = [],
  limit = 10,
): RankedPlayer[] {
  if (roster.length === 0) return [];

  const lastNameCounts = countLastNames(roster);
  const haystacks = articles.map((a) => `${a.title} ${a.description}`);

  // Best (lowest) rank each athlete achieved in any statistical category.
  const bestLeaderEntry = new Map<string, StatLeader>();
  for (const leader of leaders) {
    const existing = bestLeaderEntry.get(leader.athleteId);
    if (!existing || leader.rank < existing.rank) bestLeaderEntry.set(leader.athleteId, leader);
  }

  const ranked: RankedPlayer[] = roster.map((player) => {
    const fullName = normalizeName(player.fullName);
    const firstLast = normalizeName(`${player.firstName} ${player.lastName}`);
    const lastName = normalizeName(player.lastName);

    const lastNameIsUsable =
      lastName.length >= MIN_LAST_NAME_LENGTH &&
      (lastNameCounts.get(player.lastName.toLowerCase()) ?? 0) === 1;

    // Compiled once per player, not once per (player, article) pair — this
    // loop runs roster.length × articles.length times, and rebuilding a
    // RegExp on every single comparison (as wordBoundaryMatch does) adds up
    // to tens of thousands of compiles for a full roster against a full
    // pool. Reusing a compiled pattern here is the same match, much faster.
    const fullNameRegex = compileWordBoundary(fullName);
    const firstLastRegex = firstLast !== fullName ? compileWordBoundary(firstLast) : null;
    const lastNameRegex = lastNameIsUsable ? compileWordBoundary(lastName) : null;

    let mentions = 0;
    let score = 0;

    for (const haystack of haystacks) {
      const namedInFull = fullNameRegex.test(haystack) || (firstLastRegex?.test(haystack) ?? false);

      if (namedInFull) {
        mentions += 1;
        score += FULL_NAME_POINTS;
      } else if (lastNameRegex?.test(haystack)) {
        mentions += 1;
        score += LAST_NAME_POINTS;
      }
    }

    const leaderEntry = bestLeaderEntry.get(player.id);
    if (leaderEntry) {
      // Top of a category counts for more than third in it.
      score += Math.max(5 - leaderEntry.rank, 1);
    }

    const detail = mentions > 0
      ? `${mentions} article${mentions === 1 ? '' : 's'}`
      : leaderEntry
        ? `${leaderEntry.category.replace(/ Leader$/, '')} · ${leaderEntry.displayValue}`
        : '';

    return { player, mentions, score, detail };
  });

  const sorted = ranked
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.mentions !== a.mentions) return b.mentions - a.mentions;
      return (b.player.experienceYears ?? 0) - (a.player.experienceYears ?? 0);
    });

  return sorted.slice(0, limit);
}
