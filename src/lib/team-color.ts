import { fetchWithTimeout } from '@/lib/http';

const colorCache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();

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
  if (colorCache.has(teamId)) return colorCache.get(teamId)!;

  const existing = inFlight.get(teamId);
  if (existing) return existing;

  const promise = fetchTeamColorUncached(teamId)
    .then((color) => {
      colorCache.set(teamId, color);
      return color;
    })
    .finally(() => {
      inFlight.delete(teamId);
    });

  inFlight.set(teamId, promise);
  return promise;
}
