import { afterEach, describe, expect, it, vi } from 'vitest';

import scoreboardFixture from '@/lib/__fixtures__/espn-scoreboard.json';
import { favoriteKey } from '@/lib/favorite-keys';
import { DEFAULT_LEAGUE, getLeague } from '@/lib/league-catalog';
import { League } from '@/lib/leagues';
import { fetchScoreboard, followedGames, LiveGame, parseScoreboard, scoreboardUrl } from '@/lib/scoreboard';

const NFL = getLeague('nfl')!;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('scoreboardUrl', () => {
  it('filters a conference with `groups`, plural', () => {
    expect(DEFAULT_LEAGUE.espnGroup).toBeDefined();
    expect(scoreboardUrl(DEFAULT_LEAGUE)).toBe(
      `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=${DEFAULT_LEAGUE.espnGroup}`,
    );
  });

  it('asks for the whole board for a league with no conferences', () => {
    expect(scoreboardUrl(NFL)).toBe('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
  });
});

describe('parseScoreboard', () => {
  const games = parseScoreboard(scoreboardFixture, NFL);
  const byId = (id: string) => games.find((g) => g.id === id)!;

  it('drops an event with one competitor and an event with no id', () => {
    expect(games.map((g) => g.id)).toEqual(['401872945', '401872932', '401872950', '401872960']);
  });

  it('reads state, status and the league it came from', () => {
    expect(games.map((g) => g.state)).toEqual(['post', 'post', 'in', 'pre']);
    expect(byId('401872945')).toMatchObject({
      leagueId: 'nfl',
      statusDetail: 'Final/OT',
      completed: true,
      period: 5,
      startDate: '2026-09-21T00:20Z',
    });
  });

  it('names a team by its location, which reads as a singular subject', () => {
    expect(byId('401872945').home).toEqual({ teamId: '12', abbreviation: 'KC', name: 'Kansas City', score: 33 });
  });

  it('accepts a score as a number or as a string', () => {
    expect(byId('401872950').home.score).toBe(17);
    expect(byId('401872950').away.score).toBe(21);
  });

  it('keeps down and distance only while the game is in progress', () => {
    expect(byId('401872950').situation).toEqual({
      downDistanceText: '3rd & 4 at SF 34',
      possessionTeamId: '25',
      isRedZone: false,
      lastPlayText: 'B.Purdy pass short left to G.Kittle for 6 yards.',
    });
    // The pre game carries a stale situation block in the fixture.
    expect(byId('401872960').situation).toBeNull();
    expect(byId('401872945').situation).toBeNull();
  });

  it('reads the network from each broadcast shape ESPN uses', () => {
    expect(byId('401872945').network).toBe('NBC'); // broadcasts[].names
    expect(byId('401872950').network).toBe('FOX'); // geoBroadcasts only
    expect(byId('401872960').network).toBe('Prime Video'); // broadcasts[].media.shortName
  });

  it('reads a neutral site', () => {
    expect(byId('401872960').neutralSite).toBe(true);
    expect(byId('401872945').neutralSite).toBe(false);
  });
});

function liveGame(id: string, state: LiveGame['state'], home: string, away: string, startDate: string): LiveGame {
  return {
    id,
    leagueId: 'x',
    state,
    startDate,
    statusDetail: '',
    completed: state === 'post',
    clock: null,
    period: null,
    network: null,
    neutralSite: false,
    home: { teamId: home, abbreviation: home, name: home, score: 0 },
    away: { teamId: away, abbreviation: away, name: away, score: 0 },
    situation: null,
  };
}

describe('followedGames', () => {
  const bigTen: League = DEFAULT_LEAGUE;
  const sec = getLeague('sec')!;

  it('keeps only games with a followed team, and says which side that is', () => {
    const games = followedGames(
      [
        {
          league: bigTen,
          games: [liveGame('1', 'pre', '194', '130', '2026-09-26T16:00Z'), liveGame('2', 'pre', '1', '2', '2026-09-26T16:00Z')],
        },
      ],
      [favoriteKey(bigTen.id, '130')],
    );
    expect(games.map((g) => g.id)).toEqual(['1']);
    expect(games[0]).toMatchObject({ followedSide: 'away', followedTeamId: '130' });
  });

  it('matches followed teams league-qualified, not by bare id', () => {
    const games = followedGames(
      [{ league: NFL, games: [liveGame('1', 'pre', '130', '9', '2026-09-26T16:00Z')] }],
      [favoriteKey(bigTen.id, '130')],
    );
    expect(games).toEqual([]);
  });

  it('lists a game on two conference boards once', () => {
    const shared = liveGame('9', 'in', '194', '61', '2026-09-26T16:00Z');
    const games = followedGames(
      [
        { league: bigTen, games: [shared] },
        { league: sec, games: [shared] },
      ],
      [favoriteKey(bigTen.id, '194'), favoriteKey(sec.id, '61')],
    );
    expect(games).toHaveLength(1);
    // Both sides followed: home, stably.
    expect(games[0].followedSide).toBe('home');
  });

  it('orders live, then upcoming by kickoff, then finished', () => {
    const games = followedGames(
      [
        {
          league: bigTen,
          games: [
            liveGame('post', 'post', 'a', 'x', '2026-09-26T12:00Z'),
            liveGame('late', 'pre', 'b', 'x', '2026-09-26T23:00Z'),
            liveGame('live', 'in', 'c', 'x', '2026-09-26T16:00Z'),
            liveGame('early', 'pre', 'd', 'x', '2026-09-26T19:00Z'),
          ],
        },
      ],
      ['a', 'b', 'c', 'd'].map((t) => favoriteKey(bigTen.id, t)),
    );
    expect(games.map((g) => g.id)).toEqual(['live', 'early', 'late', 'post']);
  });
});

describe('fetchScoreboard', () => {
  it('fetches the league\'s board and parses it', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => scoreboardFixture }));
    vi.stubGlobal('fetch', fetchMock);
    const games = await fetchScoreboard(NFL, { force: true });
    expect(games).toHaveLength(4);
    expect(fetchMock).toHaveBeenCalledWith(scoreboardUrl(NFL), expect.anything());
  });

  it('serves a second call inside the TTL from cache', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => scoreboardFixture }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchScoreboard(NFL, { force: true });
    await fetchScoreboard(NFL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches conferences separately even though they share a sport path', async () => {
    const sec = getLeague('sec')!;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => ({ events: url.includes(`groups=${sec.espnGroup}`) ? [] : scoreboardFixture.events }),
      })),
    );
    await fetchScoreboard(DEFAULT_LEAGUE, { force: true });
    await expect(fetchScoreboard(sec, { force: true })).resolves.toEqual([]);
    await expect(fetchScoreboard(DEFAULT_LEAGUE)).resolves.toHaveLength(4);
  });
});
