/**
 * The one place a league's identity lives. Everything league-specific that
 * used to be hardcoded into the data modules goes here instead, so adding a
 * second conference or sport is a new descriptor rather than a rewrite.
 *
 * The `espn*` fields are the pieces ESPN's URL structure needs. Build URLs
 * with the helpers below rather than interpolating these fields directly —
 * ESPN uses two different path shapes for the same league and getting them
 * mixed up produces a 404 that looks like a dead endpoint.
 */
export interface League {
  /** Stable internal key. Used to cache each league's team list separately. */
  id: string;
  /** e.g. "Big Ten" — safe to show in UI. */
  displayName: string;
  /** ESPN's sport segment, e.g. "football". */
  espnSport: string;
  /** ESPN's league segment, e.g. "college-football". */
  espnLeaguePath: string;
  /**
   * ESPN's conference/group filter id. Optional: a whole league (the NFL,
   * the NBA) has no conference to filter by, and querying without a group
   * returns a differently-shaped standings response — see teams.ts.
   */
  espnGroup?: number;
  /**
   * Zero-based month from which the *new* season's year becomes the one to
   * query for stats. Not quite "when the first game is played": college
   * football opens in late August, but ESPN has no stats for a season until
   * games have actually been played, so asking for the new year before
   * September returns nothing. September (8) is the value that has always
   * been in effect here.
   *
   * On the descriptor because it is wrong for almost every other sport —
   * which is the entire reason this field exists rather than a constant.
   */
  seasonStartMonth?: number;
}

/**
 * group=5 is the Big Ten — verified against ESPN's response, which tags the
 * conference "big10" and returns its current 18 members.
 */
export const BIG_TEN: League = {
  id: 'big-ten',
  displayName: 'Big Ten',
  espnSport: 'football',
  espnLeaguePath: 'college-football',
  espnGroup: 5,
  seasonStartMonth: 8,
};

/**
 * The `site.api` / `site.web.api` path shape: `<sport>/<league>`.
 * Used by rosters, schedules, team pages, team news and player stats.
 */
export function espnSitePath(league: League): string {
  return `${league.espnSport}/${league.espnLeaguePath}`;
}

/**
 * The `sports.core.api` path shape: `<sport>/leagues/<league>`.
 *
 * Note the extra `leagues` segment. This is the single easiest thing to get
 * wrong in this codebase — two modules use it and five don't, so grepping
 * for "football/college-football" silently misses the core-API callers.
 * Naming it is what stops that happening again.
 */
export function espnCorePath(league: League): string {
  return `${league.espnSport}/leagues/${league.espnLeaguePath}`;
}

/**
 * Cache key for a per-entity fetch (a team, a player).
 *
 * A correctness fix, not tidiness: ESPN entity ids are only unique *within
 * a sport*, so NBA team 13 and college-football team 13 are different teams
 * that would otherwise share a roster cache entry and serve each other's
 * data. Keyed on the sport and league path rather than `league.id` on
 * purpose — two conferences of the same sport share ESPN's id space, so
 * Big Ten and Big 12 should share the cached roster for team 130, not
 * fetch it twice.
 */
export function espnCacheKey(league: League, entityId: string): string {
  return `${espnSitePath(league)}:${entityId}`;
}

const DEFAULT_SEASON_START_MONTH = 8; // September — see seasonStartMonth

/**
 * The most recently *completed* season, labelled by its starting year.
 * Seasons that straddle a new year are labelled by the year they began, so
 * for most of the calendar year this is last year's number.
 */
export function lastCompletedSeason(league: League, now: Date = new Date()): number {
  const startMonth = league.seasonStartMonth ?? DEFAULT_SEASON_START_MONTH;
  return now.getMonth() >= startMonth ? now.getFullYear() : now.getFullYear() - 1;
}
