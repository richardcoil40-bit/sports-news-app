import { createEntityCache } from '@/lib/cache';
import { fetchWithTimeout } from '@/lib/http';
import { DEFAULT_LEAGUE } from '@/lib/league-catalog';
import { espnCacheKey, espnCorePath, lastCompletedSeason, League } from '@/lib/leagues';

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

/** Athlete IDs are only present inside the $ref URL — there's no plain id field. */
function athleteIdFromRef(ref: string | undefined): string | null {
  if (!ref) return null;
  const match = ref.match(/athletes\/(\d+)/);
  return match ? match[1] : null;
}

const cache = createEntityCache<string, StatLeader[]>();

async function fetchUncached(teamId: string, league: League): Promise<StatLeader[]> {
  const season = lastCompletedSeason(league);
  const url = `https://sports.core.api.espn.com/v2/sports/${espnCorePath(league)}/seasons/${season}/types/2/teams/${teamId}/leaders`;

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
export async function fetchTeamStatLeaders(
  teamId: string,
  league: League = DEFAULT_LEAGUE,
): Promise<StatLeader[]> {
  // Failures degrade to (and are cached as) empty — leaders are a nice-to-have
  // second opinion, not something worth failing a screen over.
  return cache.get(espnCacheKey(league, teamId), () =>
    fetchUncached(teamId, league).catch(() => [] as StatLeader[]),
  );
}
