import { League } from '@/lib/leagues';

/**
 * Grouping the catalog into the Sport → Level → League picker.
 *
 * Pure functions over a league list rather than a second data file: the
 * taxonomy *is* the catalog, read a different way. Adding the NFL for
 * real means editing `__data__/leagues.json` and nothing here — which is
 * the whole point of leagues being data.
 *
 * Order follows the catalog rather than being sorted alphabetically, so
 * the order leagues are declared in is the order they appear. Sorting
 * would put a planned league above a working one on nothing but its
 * first letter.
 */

/** Leagues that declared neither sport nor level still have to go somewhere. */
export const UNFILED = 'Other';

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

export function sportsIn(leagues: League[]): string[] {
  return distinct(leagues.map((league) => league.sport ?? UNFILED));
}

export function levelsIn(leagues: League[], sport: string): string[] {
  return distinct(
    leagues.filter((league) => (league.sport ?? UNFILED) === sport).map((l) => l.level ?? UNFILED),
  );
}

export function leaguesIn(leagues: League[], sport: string, level: string): League[] {
  return leagues.filter(
    (league) => (league.sport ?? UNFILED) === sport && (league.level ?? UNFILED) === level,
  );
}

/**
 * Whether everything under this node is planned. Drives the "not
 * available yet" note on a level, so the reader learns that before
 * tapping into it rather than after.
 */
export function allPlanned(leagues: League[]): boolean {
  return leagues.length > 0 && leagues.every((league) => league.status === 'planned');
}
