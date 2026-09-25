import { createEntityCache } from '@/lib/cache';
import { fetchWithTimeout } from '@/lib/http';
import { espnCacheKey, espnCorePath, League } from '@/lib/leagues';

export interface StatLeader {
  athleteId: string;
  /**
   * ESPN's key for the category, e.g. "passingLeader" or "totalTackles" —
   * what a league's `leaderCategories` names. Falls back to the display
   * name when ESPN sends none, so the category can still be shown.
   */
  categoryName: string;
  /** e.g. "Passing Leader" */
  category: string;
  /** e.g. "3,323" or "168 CAR, 1035 YDS, 5 TD" */
  displayValue: string;
  /** 0 = top of that category */
  rank: number;
}

interface RawLeader {
  displayValue?: unknown;
  athlete?: { $ref?: unknown };
}

interface RawCategory {
  displayName?: unknown;
  name?: unknown;
  leaders?: unknown;
}

/**
 * Every field here ends up rendered as text, and a number or an object that
 * reached a string method would throw in render rather than in this parser,
 * where the junk-shape tests can't see it. So anything that isn't a
 * non-empty string reads as absent.
 */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Athlete IDs are only present inside the $ref URL — there's no plain id field. */
function athleteIdFromRef(ref: unknown): string | null {
  if (typeof ref !== 'string') return null;
  const match = ref.match(/athletes\/(\d+)/);
  return match ? match[1] : null;
}

// Keyed by a team the user visited, so bounded like roster.ts — see the note
// there. A few stat lines per entry, so the ceiling is generous.
const cache = createEntityCache<string, StatLeader[]>({ maxEntries: 100 });

async function fetchUncached(teamId: string, league: League, season: number): Promise<StatLeader[]> {
  const url = `https://sports.core.api.espn.com/v2/sports/${espnCorePath(league)}/seasons/${season}/types/2/teams/${teamId}/leaders`;

  const response = await fetchWithTimeout(url);
  // ESPN's answer for a season with no games yet (checked 2026-09-24 against
  // 2027): 404, "No stats found." That is a true empty, so it resolves and is
  // cached like one.
  if (response.status === 404) return [];
  // Anything else that failed throws, and stays uncached so the next visit
  // retries, the way roster.ts does. These leaders are the Players tab's
  // whole content, and an empty result there reads "No stat leaders yet this
  // season": a false statement, and one this cache would keep repeating for
  // the rest of the session.
  if (!response.ok) throw new Error(`Stat leaders responded ${response.status}`);
  const json = await response.json();
  const categories: unknown[] = Array.isArray(json?.categories) ? json.categories : [];

  // Entry by entry, so one malformed category or leader costs only itself.
  const leaders: StatLeader[] = [];
  for (const raw of categories) {
    if (!raw || typeof raw !== 'object') continue;
    const category = raw as RawCategory;
    const label = text(category.displayName) ?? text(category.name) ?? 'Leader';
    const categoryName = text(category.name) ?? label;
    const rawLeaders: unknown[] = Array.isArray(category.leaders) ? category.leaders : [];

    rawLeaders.forEach((entry, index) => {
      const leader = (entry && typeof entry === 'object' ? entry : {}) as RawLeader;
      const athleteId = athleteIdFromRef(leader.athlete?.$ref);
      if (!athleteId) return;
      leaders.push({
        athleteId,
        categoryName,
        category: label,
        displayValue: text(leader.displayValue) ?? '',
        // Position in ESPN's list, which is its ranking — counted before
        // skipping a leader with no id, so a gap doesn't promote anyone.
        rank: index,
      });
    });
  }

  return leaders;
}

/**
 * A team's statistical leaders for one regular season. Every category ESPN
 * returns; which to show, and in what order, is the league's call (see
 * `leaderCategories` and `leader-boards.ts`). Players who have since left
 * are dropped there, by cross-referencing the current roster.
 *
 * The season is the caller's, and required, for the reason
 * `fetchPlayerSeasonStats` takes one: the team screen picks it once and
 * hands the same number to the header, to this, and to the player screen a
 * leader opens. Computed separately, they could name different years.
 */
export async function fetchTeamStatLeaders(
  teamId: string,
  league: League,
  season: number,
): Promise<StatLeader[]> {
  // The season is in the key so a process that lives across a season's start
  // doesn't serve last year's leaders under this year's heading.
  return cache.get(`${espnCacheKey(league, teamId)}:${season}`, () =>
    fetchUncached(teamId, league, season),
  );
}
