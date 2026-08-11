const FETCH_TIMEOUT_MS = 10000;

export interface StatLeader {
  athleteId: string;
  /** e.g. "Passing Leader" */
  category: string;
  /** e.g. "3,323" or "168 CAR, 1035 YDS, 5 TD" */
  displayValue: string;
  /** 0 = top of that category */
  rank: number;
}

interface RawLeader {
  displayValue?: string;
  athlete?: { $ref?: string };
}

interface RawCategory {
  displayName?: string;
  name?: string;
  leaders?: RawLeader[];
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

/**
 * College football seasons run from late August into January and are labelled
 * by their starting year, so for most of the calendar year the most recent
 * completed season is the previous year's.
 */
function lastCompletedSeason(now: Date = new Date()): number {
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
}

/** Athlete IDs are only present inside the $ref URL — there's no plain id field. */
function athleteIdFromRef(ref: string | undefined): string | null {
  if (!ref) return null;
  const match = ref.match(/athletes\/(\d+)/);
  return match ? match[1] : null;
}

const cache = new Map<string, StatLeader[]>();
const inFlight = new Map<string, Promise<StatLeader[]>>();

async function fetchUncached(teamId: string): Promise<StatLeader[]> {
  const season = lastCompletedSeason();
  const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/${season}/types/2/teams/${teamId}/leaders`;

  const response = await fetchWithTimeout(url);
  if (!response.ok) return [];
  const json = await response.json();
  const categories: RawCategory[] = json?.categories ?? [];

  const leaders: StatLeader[] = [];
  for (const category of categories) {
    const label = category.displayName ?? category.name ?? 'Leader';
    (category.leaders ?? []).forEach((leader, index) => {
      const athleteId = athleteIdFromRef(leader.athlete?.$ref);
      if (!athleteId) return;
      leaders.push({
        athleteId,
        category: label,
        displayValue: leader.displayValue ?? '',
        rank: index,
      });
    });
  }

  return leaders;
}

/**
 * Statistical leaders for the most recent completed season. Used as a second
 * opinion on who matters, since article volume alone is noisy in the
 * offseason. Players who have since left are filtered out naturally by
 * cross-referencing against the current roster.
 */
export async function fetchTeamStatLeaders(teamId: string): Promise<StatLeader[]> {
  const cached = cache.get(teamId);
  if (cached) return cached;

  const existing = inFlight.get(teamId);
  if (existing) return existing;

  const promise = fetchUncached(teamId)
    .catch(() => [] as StatLeader[])
    .then((leaders) => {
      cache.set(teamId, leaders);
      return leaders;
    })
    .finally(() => {
      inFlight.delete(teamId);
    });

  inFlight.set(teamId, promise);
  return promise;
}
