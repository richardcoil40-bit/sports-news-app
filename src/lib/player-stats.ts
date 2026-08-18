import { createEntityCache } from '@/lib/cache';
import { fetchWithTimeout } from '@/lib/http';
import { BIG_TEN, espnCacheKey, espnSitePath, League } from '@/lib/leagues';

/**
 * Pinned to the 2025 season for this first pass rather than computed from
 * today's date (compare lastCompletedSeason() in team-leaders.ts) — once the
 * 2026 season starts generating box scores this should move to the same
 * "most recently completed season" logic, but for now the ask is 2025 only.
 */
export const PLAYER_STATS_SEASON = 2025;

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

const cache = createEntityCache<string, PlayerStatCategory[]>();

async function fetchUncached(athleteId: string, league: League): Promise<PlayerStatCategory[]> {
  const url = `https://site.web.api.espn.com/apis/common/v3/sports/${espnSitePath(league)}/athletes/${athleteId}/stats`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) return [];
  const json = await response.json();
  const categories: RawCategory[] = json?.categories ?? [];

  const result: PlayerStatCategory[] = [];
  for (const category of categories) {
    const seasonEntry = (category.statistics ?? []).find(
      (entry) => entry.season?.year === PLAYER_STATS_SEASON,
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
 * A player's 2025 season stats, broken out by category (passing, rushing,
 * receiving, defense, etc. — whichever ones ESPN actually recorded for
 * them). Cached per athlete since the player detail screen is the only
 * consumer and re-visiting it shouldn't re-fetch.
 */
export async function fetchPlayerSeasonStats(
  athleteId: string,
  league: League = BIG_TEN,
): Promise<PlayerStatCategory[]> {
  // Failures degrade to (and are cached as) empty — a player screen without a
  // stats card is fine; one that fails to load isn't.
  return cache.get(espnCacheKey(league, athleteId), () =>
    fetchUncached(athleteId, league).catch(() => [] as PlayerStatCategory[]),
  );
}
