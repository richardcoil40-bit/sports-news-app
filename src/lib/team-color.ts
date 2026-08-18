import { createEntityCache } from '@/lib/cache';
import { fetchWithTimeout } from '@/lib/http';

// `null` is a real cached answer here ("no usable color"), not a miss.
const colorCache = createEntityCache<string, string | null>();

async function fetchTeamColorUncached(teamId: string): Promise<string | null> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${teamId}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) return null;
  const json = await response.json();
  const raw: string | undefined = json?.team?.color;
  if (!raw || raw.toLowerCase() === 'ffffff') return null;
  return `#${raw}`;
}

/** Each team's real primary color, straight from ESPN — used as the one flat accent per team screen. */
export async function fetchTeamColor(teamId: string): Promise<string | null> {
  return colorCache.get(teamId, () => fetchTeamColorUncached(teamId));
}
