/**
 * The one place a league's identity lives. Everything league-specific that
 * used to be hardcoded into `teams.ts` goes here instead, so adding a second
 * conference or sport is a new constant rather than a rewrite.
 *
 * The `espn*` fields are the pieces ESPN's URL structure needs — its endpoints
 * are all shaped `/sports/<sport>/<league>/...` with a numeric group filter
 * for the conference.
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
  /** ESPN's conference/group filter id. */
  espnGroup: number;
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
};
