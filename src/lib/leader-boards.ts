import { League } from '@/lib/leagues';
import { Player } from '@/lib/roster';
import { StatLeader } from '@/lib/team-leaders';

export interface LeaderEntry {
  player: Player;
  /**
   * The stat line under the name, exactly as ESPN writes it: "39 CAR, 230
   * YDS, 2 TD" for a composite category, a bare "17" for a single stat. The
   * card's title names the stat, so a bare number needs no unit — ESPN's
   * abbreviations ("17 TOT", "1 SACK") read worse than the number alone.
   */
  detail: string;
  /**
   * Whether surname-only matching is safe for this player, which the
   * player's screen has to be told so its News tab doesn't list a
   * teammate's headlines as this player's. False when someone else on the
   * roster shares the surname.
   */
  matchesSurname: boolean;
}

export interface LeaderBoard {
  /** ESPN's category key, e.g. "rushingLeader". */
  name: string;
  /** For the card title, e.g. "Rushing". */
  title: string;
  entries: LeaderEntry[];
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
 * A team's stat leaders, grouped into one board per category.
 *
 * Which categories, and in what order, is the league's call —
 * `league.leaderCategories`, from the catalog — because "key stats" are
 * different for every sport. A league that names none gets every category
 * ESPN returns, in ESPN's order.
 *
 * Leaders are joined to the current roster and the cut to `top` is made
 * *after* that, so a player who has left doesn't leave a board short (ESPN
 * keeps them in a completed season's leaders). A board left with nobody is
 * dropped rather than shown empty.
 */
export function leaderBoards(
  leaders: StatLeader[],
  roster: Player[],
  league: League,
  top = 3,
): LeaderBoard[] {
  const byId = new Map(roster.map((player) => [player.id, player]));
  const lastNameCounts = countLastNames(roster);

  // ESPN's order within a category is its ranking; `rank` records it.
  const grouped = new Map<string, StatLeader[]>();
  for (const leader of [...leaders].sort((a, b) => a.rank - b.rank)) {
    const list = grouped.get(leader.categoryName);
    if (list) list.push(leader);
    else grouped.set(leader.categoryName, [leader]);
  }

  const order = league.leaderCategories ?? [...grouped.keys()];

  const boards: LeaderBoard[] = [];
  for (const name of order) {
    const categoryLeaders = grouped.get(name);
    if (!categoryLeaders) continue;

    const entries: LeaderEntry[] = [];
    for (const leader of categoryLeaders) {
      const player = byId.get(leader.athleteId);
      if (!player) continue;
      entries.push({
        player,
        detail: leader.displayValue,
        matchesSurname: (lastNameCounts.get(player.lastName.toLowerCase()) ?? 0) === 1,
      });
      if (entries.length === top) break;
    }
    if (entries.length === 0) continue;

    boards.push({
      name,
      // "Passing Leader" is ESPN's football wording for its composite lines;
      // the card title is the stat, and every other card is already just that.
      title: categoryLeaders[0].category.replace(/ Leader$/, ''),
      entries,
    });
  }

  return boards;
}
