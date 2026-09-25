import { createEntityCache } from '@/lib/cache';
import { fetchWithTimeout } from '@/lib/http';
import { espnSeasonCacheKey, espnSitePath, League } from '@/lib/leagues';

export interface PlayerStatCategory {
  /** e.g. "receiving" */
  name: string;
  /** e.g. "Receiving" */
  displayName: string;
  /** e.g. ["REC", "YDS", "AVG", "TD", "LNG"] */
  labels: string[];
  /** e.g. ["Receptions", "Receiving Yards", ...] — same length/order as labels. */
  descriptions: string[];
  /** e.g. ["3", "31", "10.3", "0", "14"] — same length/order as labels. */
  values: string[];
}

/** A player's stats for one season, and which season that is. */
export interface PlayerSeasonStats {
  season: number;
  categories: PlayerStatCategory[];
}

interface RawStatEntry {
  season?: { year?: number };
  stats?: string[];
}

interface RawCategory {
  name?: string;
  displayName?: string;
  labels?: string[];
  displayNames?: string[];
  statistics?: RawStatEntry[];
}

/** A category where every recorded value is zero/blank isn't worth a card (e.g. a punt return line for a WR who fielded one and gained nothing). */
function hasSignal(values: string[]): boolean {
  return values.some((v) => v && v !== '0' && v !== '0.0' && v !== '-');
}

// The one cache keyed by *player* rather than by team, so its ceiling is
// every athlete across every roster rather than every team — a far larger
// number, and the reason its bound is larger too. Entries are a handful of
// stat lines each.
const cache = createEntityCache<string, PlayerStatCategory[]>({ maxEntries: 500 });

async function fetchUncached(
  athleteId: string,
  league: League,
  season: number,
): Promise<PlayerStatCategory[]> {
  const url = `https://site.web.api.espn.com/apis/common/v3/sports/${espnSitePath(league)}/athletes/${athleteId}/stats`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) return [];
  const json = await response.json();
  const categories: RawCategory[] = json?.categories ?? [];

  const result: PlayerStatCategory[] = [];
  for (const category of categories) {
    const seasonEntry = (category.statistics ?? []).find(
      (entry) => entry.season?.year === season,
    );
    if (!seasonEntry?.stats || !hasSignal(seasonEntry.stats)) continue;

    result.push({
      name: category.name ?? category.displayName ?? 'stats',
      displayName: category.displayName ?? category.name ?? 'Stats',
      labels: category.labels ?? [],
      descriptions: category.displayNames ?? category.labels ?? [],
      values: seasonEntry.stats,
    });
  }

  return result;
}

/**
 * A player's stats for one season, broken out by category (passing, rushing,
 * receiving, defense, etc. — whichever ones ESPN actually recorded for
 * them). Cached per athlete and season since the player detail screen is the
 * only consumer and re-visiting it shouldn't re-fetch.
 *
 * The season is the caller's, and required. This used to be pinned to 2025,
 * which outlived the 2026 season's first games: a 2026 stat leader opened
 * onto last season's numbers, or onto "no stats" for a first-year starter.
 * The player screen passes the season of the leaders you tapped, so the two
 * screens can't name different years.
 */
export async function fetchPlayerSeasonStats(
  athleteId: string,
  league: League,
  season: number,
): Promise<PlayerStatCategory[]> {
  // Failures degrade to (and are cached as) empty — a player screen without a
  // stats card is fine; one that fails to load isn't. The season is in the
  // key so a process that lives across a season's start doesn't serve the
  // old year's line for the new one.
  return cache.get(espnSeasonCacheKey(league, athleteId, season), () =>
    fetchUncached(athleteId, league, season).catch(() => [] as PlayerStatCategory[]),
  );
}
