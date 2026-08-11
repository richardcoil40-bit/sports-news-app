const FETCH_TIMEOUT_MS = 10000;

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

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** A category where every recorded value is zero/blank isn't worth a card (e.g. a punt return line for a WR who fielded one and gained nothing). */
function hasSignal(values: string[]): boolean {
  return values.some((v) => v && v !== '0' && v !== '0.0' && v !== '-');
}

const cache = new Map<string, PlayerStatCategory[]>();
const inFlight = new Map<string, Promise<PlayerStatCategory[]>>();

async function fetchUncached(athleteId: string): Promise<PlayerStatCategory[]> {
  const url = `https://site.web.api.espn.com/apis/common/v3/sports/football/college-football/athletes/${athleteId}/stats`;
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
export async function fetchPlayerSeasonStats(athleteId: string): Promise<PlayerStatCategory[]> {
  const cached = cache.get(athleteId);
  if (cached) return cached;

  const existing = inFlight.get(athleteId);
  if (existing) return existing;

  const promise = fetchUncached(athleteId)
    .catch(() => [] as PlayerStatCategory[])
    .then((categories) => {
      cache.set(athleteId, categories);
      return categories;
    })
    .finally(() => {
      inFlight.delete(athleteId);
    });

  inFlight.set(athleteId, promise);
  return promise;
}
