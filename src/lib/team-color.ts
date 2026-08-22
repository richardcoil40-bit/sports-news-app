import { createEntityCache } from '@/lib/cache';
import { fetchWithTimeout } from '@/lib/http';
import { espnCacheKey, espnSitePath, League } from '@/lib/leagues';

// `null` is a real cached answer here ("no usable color"), not a miss.
// Bounded like the other visited-team caches; entries are a single hex
// string, so the bound is about the key count, not the payload.
const colorCache = createEntityCache<string, string | null>({ maxEntries: 100 });

async function fetchTeamColorUncached(teamId: string, league: League): Promise<string | null> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnSitePath(league)}/teams/${teamId}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) return null;
  const json = await response.json();
  const raw: string | undefined = json?.team?.color;
  if (!raw || raw.toLowerCase() === 'ffffff') return null;
  return `#${raw}`;
}

/** Each team's real primary color, straight from ESPN — used as the one flat accent per team screen. */
export async function fetchTeamColor(teamId: string, league: League): Promise<string | null> {
  return colorCache.get(espnCacheKey(league, teamId), () => fetchTeamColorUncached(teamId, league));
}
