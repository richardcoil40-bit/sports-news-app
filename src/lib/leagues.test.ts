import { afterEach, describe, expect, it, vi } from 'vitest';

import nestedStandingsFixture from '@/lib/__fixtures__/espn-standings-nested.json';
import { DEFAULT_LEAGUE } from '@/lib/league-catalog';
import {
  espnCacheKey,
  espnCorePath,
  espnSitePath,
  lastCompletedSeason,
  League,
} from '@/lib/leagues';
import { fetchTeams } from '@/lib/teams';

/**
 * The league boundary is the thing that decides whether adding a sport is a
 * descriptor change or a rewrite, and it's invisible while only one league
 * exists — nothing in the app exercises the "no conference filter" path or
 * the cache-collision case. So these tests stand in for the second league.
 *
 * The NBA descriptor below is a **test fixture, not a shipped league.** It
 * deliberately lives here rather than in leagues.ts: adding basketball is a
 * product decision, and this file only needs to prove the boundary holds.
 */
const NBA_FOR_TEST: League = {
  id: 'nba-test',
  displayName: 'NBA',
  espnSport: 'basketball',
  espnLeaguePath: 'nba',
  // No espnGroup — a whole league has no conference to filter by. This is
  // the case the app has never run.
  seasonStartMonth: 9, // October
};

function respondWith(body: unknown, { ok = true, status = 200 } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status, json: async () => body })),
  );
  return vi.mocked(globalThis.fetch);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('URL construction', () => {
  it('builds the site path used by rosters, schedules, news and stats', () => {
    expect(espnSitePath(DEFAULT_LEAGUE)).toBe('football/college-football');
    expect(espnSitePath(NBA_FOR_TEST)).toBe('basketball/nba');
  });

  // The extra "leagues" segment is the easiest thing in this codebase to get
  // wrong, because only two callers use it and grepping for the site path
  // silently misses them.
  it('builds the core path with its extra leagues segment', () => {
    expect(espnCorePath(DEFAULT_LEAGUE)).toBe('football/leagues/college-football');
    expect(espnCorePath(NBA_FOR_TEST)).toBe('basketball/leagues/nba');
  });
});

describe('espnCacheKey', () => {
  // The concrete collision: ESPN id 13 is the Los Angeles Lakers in the NBA
  // and a completely different team in college football. Keyed on the raw id
  // alone, one would serve the other's roster.
  it('separates the same entity id across sports', () => {
    expect(espnCacheKey(DEFAULT_LEAGUE, '13')).not.toBe(espnCacheKey(NBA_FOR_TEST, '13'));
  });

  // Two conferences of the same sport share ESPN's id space, so they should
  // share a cached roster rather than fetch it twice.
  it('shares a key between two conferences of the same sport', () => {
    const bigTwelve: League = { ...DEFAULT_LEAGUE, id: 'big-12', displayName: 'Big 12', espnGroup: 4 };
    expect(espnCacheKey(bigTwelve, '130')).toBe(espnCacheKey(DEFAULT_LEAGUE, '130'));
  });
});

/**
 * `lastCompletedSeason` reads `getMonth()`, which is local time — the user's
 * own calendar is what should decide whether it's football season. So these
 * build local dates with `new Date(y, m, d)`. An ISO string would be UTC and
 * lands in the previous month for anyone behind Greenwich, which is exactly
 * how the month-boundary case below first failed.
 */
const localDate = (year: number, monthIndex: number, day: number) =>
  new Date(year, monthIndex, day);

describe('lastCompletedSeason', () => {
  it('uses the league season start, not a hardcoded month', () => {
    // Mid-season and deep offseason.
    expect(lastCompletedSeason(DEFAULT_LEAGUE, localDate(2026, 10, 15))).toBe(2026);
    expect(lastCompletedSeason(DEFAULT_LEAGUE, localDate(2026, 0, 15))).toBe(2025);

    // September separates the two: college football's new season counts by
    // then, basketball's does not until October. That divergence is the
    // whole point of the field.
    const september = localDate(2026, 8, 15);
    expect(lastCompletedSeason(DEFAULT_LEAGUE, september)).toBe(2026);
    expect(lastCompletedSeason(NBA_FOR_TEST, september)).toBe(2025);
  });

  it('defaults to September when a league omits the field', () => {
    const noStart: League = { ...DEFAULT_LEAGUE, seasonStartMonth: undefined };
    expect(lastCompletedSeason(noStart, localDate(2026, 8, 15))).toBe(2026);
  });

  // Regression. College football opens in late August, so "season start
  // month" reads like it should be August — but ESPN has no stats for a
  // season until games are played, and asking for the new year in August
  // returns an empty leaders list. Caught by a live call: stat leaders
  // silently went from 154 to 0 when this was set one month early.
  it('does not roll over during the pre-season weeks of August', () => {
    expect(lastCompletedSeason(DEFAULT_LEAGUE, localDate(2026, 7, 18))).toBe(2025);
    expect(lastCompletedSeason(DEFAULT_LEAGUE, localDate(2026, 7, 31))).toBe(2025);
    expect(lastCompletedSeason(DEFAULT_LEAGUE, localDate(2026, 8, 1))).toBe(2026);
  });
});

describe('fetchTeams across league shapes', () => {
  it('omits the group filter for a league that has none', async () => {
    const fetchMock = respondWith(nestedStandingsFixture);

    await fetchTeams(NBA_FOR_TEST, { force: true });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/sports/basketball/nba/standings');
    expect(url).not.toContain('group=');
  });

  it('still sends the group filter for a conference', async () => {
    const fetchMock = respondWith({ standings: { entries: [] } });

    await fetchTeams(DEFAULT_LEAGUE, { force: true });

    expect(String(fetchMock.mock.calls[0][0])).toContain('group=5');
  });

  // Without this the whole-league path returns an empty team list, which
  // teams.ts's throw-on-non-OK comment calls out as the worst failure mode
  // available: an empty app that looks like it loaded correctly.
  it('flattens the children shape a whole-league query returns', async () => {
    respondWith(nestedStandingsFixture);

    const teams = await fetchTeams(NBA_FOR_TEST, { force: true });

    expect(teams.map((t) => t.shortName)).toEqual([
      'Celtics',
      'Hawks',
      'Lakers',
      'Pistons',
      'Spurs',
    ]);
    expect(teams.find((t) => t.shortName === 'Lakers')).toEqual({
      id: '13',
      name: 'Los Angeles Lakers',
      shortName: 'Lakers',
      abbreviation: 'LAL',
      logoUrl: 'https://a.espncdn.com/i/teamlogos/nba/500/lal.png',
      leagueId: 'nba-test',
    });
    // Celtics have no logos array in the fixture.
    expect(teams.find((t) => t.shortName === 'Celtics')?.logoUrl).toBeNull();
  });
});
