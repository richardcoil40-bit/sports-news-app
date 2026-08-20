import { Article } from '@/lib/feeds';
import { compilePlayerMatcher } from '@/lib/player-match';
import { Player } from '@/lib/roster';
import { StatLeader } from '@/lib/team-leaders';

export interface RankedPlayer {
  player: Player;
  /**
   * How many articles this player's own screen will list — i.e. the length
   * of what matchArticlesForPlayer returns, not a separate tally. The card
   * shows this number, and the two drifting apart is what made a card read
   * "4 articles" over a screen listing 2.
   */
  mentions: number;
  score: number;
  /** Short explanation of why they're on the list, shown in the UI. */
  detail: string;
  /**
   * Whether surname-only matching was allowed for this player, which the
   * player's screen has to be told so it can reproduce the same list. False
   * when a teammate shares the surname — see below.
   */
  matchesSurname: boolean;
}

const FULL_NAME_POINTS = 3;
const LAST_NAME_POINTS = 1;

function leaderPoints(leader: StatLeader | undefined): number {
  return leader ? Math.max(5 - leader.rank, 1) : 0;
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
    // Two players named Smith and a "Smith" in a headline is not evidence
    // about either of them. The length floor lives in the matcher; only
    // this half depends on the roster.
    const matchesSurname = (lastNameCounts.get(player.lastName.toLowerCase()) ?? 0) === 1;
    const match = compilePlayerMatcher(player, { allowLastName: matchesSurname });
    const leaderEntry = bestLeaderEntry.get(player.id);

    let named = 0;
    let surnameOnly = 0;

    for (const haystack of haystacks) {
      const kind = match(haystack);
      if (kind === 'full') named += 1;
      else if (kind === 'last') surnameOnly += 1;
    }

    // Counted the way matchArticlesForPlayer builds its list — precise
    // matches when there are any, surname-only matches otherwise — because
    // that list is what the number is a summary *of*. Adding the two
    // buckets together (which is what this used to do) counts articles the
    // player's screen then declines to show.
    const mentions = named > 0 ? named : surnameOnly;

    // Scoring is a separate question and still weighs both buckets: a
    // surname mention is weak evidence of notability, not no evidence, and
    // this number decides ordering rather than being shown to anyone.
    const score =
      named * FULL_NAME_POINTS +
      surnameOnly * LAST_NAME_POINTS +
      // Top of a category counts for more than third in it.
      leaderPoints(leaderEntry);

    const detail = mentions > 0
      ? `${mentions} article${mentions === 1 ? '' : 's'}`
      : leaderEntry
        ? `${leaderEntry.category.replace(/ Leader$/, '')} · ${leaderEntry.displayValue}`
        : '';

    return { player, mentions, score, detail, matchesSurname };
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
