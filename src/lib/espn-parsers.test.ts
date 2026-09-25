import { afterEach, describe, expect, it, vi } from 'vitest';

import playerStatsFixture from '@/lib/__fixtures__/espn-player-stats.json';
import rosterFixture from '@/lib/__fixtures__/espn-roster.json';
import scheduleFixture from '@/lib/__fixtures__/espn-schedule.json';
import standingsFixture from '@/lib/__fixtures__/espn-standings.json';
import teamFixture from '@/lib/__fixtures__/espn-team.json';
import teamLeadersFixture from '@/lib/__fixtures__/espn-team-leaders.json';
import teamNewsFixture from '@/lib/__fixtures__/espn-team-news.json';
import { emptySummary, fetchGameSummary } from '@/lib/game-summary';
import { DEFAULT_LEAGUE } from '@/lib/league-catalog';
import { League } from '@/lib/leagues';
import { fetchPlayerSeasonStats } from '@/lib/player-stats';
import { fetchTeamRoster } from '@/lib/roster';
import { competitorScore, fetchGameOdds, fetchTeamSchedule, gameResult } from '@/lib/schedule';
import { fetchScoreboard } from '@/lib/scoreboard';
import { fetchTeamColor } from '@/lib/team-color';
import { fetchTeamStatLeaders } from '@/lib/team-leaders';
import { fetchLeagueArticles, fetchTeamArticles } from '@/lib/team-news';
import { fetchTeams } from '@/lib/teams';

function respondWith(body: unknown, { ok = true, status = 200 } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status, json: async () => body })),
  );
}

// Every module in src/lib/ caches per entity at module scope, and there's no
// reset hook by design. Unique ids per call keep tests from serving each
// other's cached values.
let seq = 0;
const freshId = () => `test-${seq++}`;

/**
 * Shapes a flaky upstream actually produces: an error page parsed as JSON, a
 * field that changed type, a partially-populated record. The documented
 * contract (AGENTS.md "Defensive parsing", docs/data-retention.md) is that
 * none of these crash — they degrade to empty.
 */
const MALFORMED_SHAPES: [string, unknown][] = [
  ['an empty object', {}],
  ['a null body', null],
  ['an array at the root', []],
  ['entirely unexpected keys', { unexpected: 'shape' }],
  [
    'the expected key present but null',
    { athletes: null, events: null, articles: null, categories: null, standings: null, items: null, team: null },
  ],
  [
    'the expected key present but a string',
    { athletes: 'nope', events: 'nope', articles: 'nope', categories: 'nope', standings: 'nope', items: 'nope', team: 'nope' },
  ],
  ['a roster group with no items array', { athletes: [{ position: 'offense' }] }],
  [
    'a competition whose competitor has no team',
    { events: [{ id: '1', date: 'd', competitions: [{ competitors: [{ homeAway: 'home' }] }] }] },
  ],
  ['articles as an object instead of an array', { articles: { headline: 'x' } }],
  ['standings entries with no team', { standings: { entries: [{}] } }],
  [
    'a drive whose plays are a string, and win probability with a numeric id and no value',
    { drives: { previous: [{ id: '1', team: { id: '2' }, plays: 'nope' }], current: 'nope' }, winprobability: [{ playId: 1 }] },
  ],
  [
    'a header whose competitors are a string, and drives as an array',
    { header: { competitions: [{ competitors: 'nope', status: 'nope' }] }, drives: [] },
  ],
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ESPN parsers degrade to empty on a malformed response', () => {
  const emptyArrayParsers: [string, (id: string, league: League) => Promise<unknown[]>][] = [
    ['fetchTeamRoster', fetchTeamRoster],
    ['fetchTeamSchedule', fetchTeamSchedule],
    ['fetchTeamArticles', fetchTeamArticles],
    // League-wide takes no entity id; it shares the id-taking shape here so
    // it runs the same gauntlet. Uncached, so no freshId is needed either.
    ['fetchLeagueArticles', (_id, league) => fetchLeagueArticles(league)],
    ['fetchTeamStatLeaders', (id, league) => fetchTeamStatLeaders(id, league, 2026)],
    ['fetchPlayerSeasonStats', (id, league) => fetchPlayerSeasonStats(id, league, 2025)],
  ];

  for (const [name, parser] of emptyArrayParsers) {
    describe(name, () => {
      for (const [label, body] of MALFORMED_SHAPES) {
        it(`returns [] for ${label}`, async () => {
          respondWith(body);
          await expect(parser(freshId(), DEFAULT_LEAGUE)).resolves.toEqual([]);
        });
      }
    });
  }

  describe('fetchTeamColor', () => {
    for (const [label, body] of MALFORMED_SHAPES) {
      it(`returns null for ${label}`, async () => {
        respondWith(body);
        await expect(fetchTeamColor(freshId(), DEFAULT_LEAGUE)).resolves.toBeNull();
      });
    }
  });

  describe('fetchGameOdds', () => {
    for (const [label, body] of MALFORMED_SHAPES) {
      it(`returns null for ${label}`, async () => {
        respondWith(body);
        await expect(fetchGameOdds(freshId(), DEFAULT_LEAGUE)).resolves.toBeNull();
      });
    }
  });

  describe('fetchScoreboard', () => {
    for (const [label, body] of MALFORMED_SHAPES) {
      it(`returns [] for ${label}`, async () => {
        respondWith(body);
        // force, because the board caches per league rather than per id.
        await expect(fetchScoreboard(DEFAULT_LEAGUE, { force: true })).resolves.toEqual([]);
      });
    }
  });

  describe('fetchGameSummary', () => {
    for (const [label, body] of MALFORMED_SHAPES) {
      it(`returns an empty summary for ${label}`, async () => {
        respondWith(body);
        const id = freshId();
        const summary = await fetchGameSummary(id, DEFAULT_LEAGUE);
        // One junk shape carries a drive with an id and a team but no
        // plays; that is a well-formed empty drive, not a crash, so only
        // the parts that can't be salvaged are asserted empty.
        expect({ ...summary, drives: [] }).toEqual(emptySummary(id));
        expect(summary.drives.every((d) => d.plays.length === 0)).toBe(true);
      });
    }
  });

  describe('fetchTeams', () => {
    for (const [label, body] of MALFORMED_SHAPES) {
      it(`returns [] for ${label}`, async () => {
        respondWith(body);
        // force, because the team list caches per league rather than per id.
        await expect(fetchTeams(DEFAULT_LEAGUE, { force: true })).resolves.toEqual([]);
      });
    }
  });
});

describe('ESPN parsers on a well-formed response', () => {
  it('fetchTeams maps standings entries and sorts by short name', async () => {
    respondWith(standingsFixture);

    const teams = await fetchTeams(DEFAULT_LEAGUE, { force: true });

    expect(teams.map((t) => t.shortName)).toEqual(['Michigan', 'Ohio State', 'Penn State']);
    expect(teams[1]).toEqual({
      id: '194',
      name: 'Ohio State Buckeyes',
      shortName: 'Ohio State',
      location: 'Ohio State',
      abbreviation: 'OSU',
      logoUrl: 'https://a.espncdn.com/i/teamlogos/ncaa/500/194.png',
      leagueId: 'big-ten',
    });
    // Penn State has no logos array in the fixture.
    expect(teams[2].logoUrl).toBeNull();
  });

  it('fetchTeamRoster keeps only real position groups', async () => {
    respondWith(rosterFixture);

    const players = await fetchTeamRoster(freshId(), DEFAULT_LEAGUE);

    // The "coaches" group is filtered out; offense and defense are kept.
    expect(players.map((p) => p.fullName)).toEqual([
      'Will Howard',
      'Jeremiah Smith',
      'Jack Sawyer',
    ]);
    expect(players[0].positionGroup).toBe('offense');
    expect(players[2].positionGroup).toBe('defense');
    expect(players[0].headshotUrl).toContain('4432762.png');
    // Jeremiah Smith has no headshot in the fixture.
    expect(players[1].headshotUrl).toBeNull();
    expect(players[1].experienceYears).toBe(1);
  });

  it('fetchTeamStatLeaders extracts athlete ids out of $ref urls', async () => {
    respondWith(teamLeadersFixture);

    const leaders = await fetchTeamStatLeaders(freshId(), DEFAULT_LEAGUE, 2026);

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(String(fetchMock.mock.calls[0][0])).toContain('/seasons/2026/types/2/');
    expect(leaders).toHaveLength(4);
    expect(leaders[0]).toEqual({
      athleteId: '4432762',
      categoryName: 'passingLeader',
      category: 'Passing Leader',
      displayValue: '56/79, 839 YDS, 6 TD, 1 INT',
      rank: 0,
    });
    expect(leaders[1].rank).toBe(1);
    // The receiving category's $ref has no athlete id, so it's dropped entirely.
    expect(leaders.map((l) => l.category)).not.toContain('Receiving Leader');
    // A category with no `name` is kept, keyed on its label.
    expect(leaders[3]).toMatchObject({ categoryName: 'Sacks', category: 'Sacks' });
  });

  // These fields are rendered as text on the Players tab. A wrongly typed
  // one has to be stopped here: past this point it throws in render, where
  // nothing catches it.
  it('fetchTeamStatLeaders reads a wrongly typed field as absent and keeps the rest', async () => {
    const ref = 'http://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2026/athletes/';
    respondWith({
      categories: [
        null,
        'nope',
        { name: 42, displayName: { text: 'Sacks' }, leaders: 'nope' },
        {
          name: 42,
          displayName: ['Tackles'],
          leaders: [
            null,
            { displayValue: 17, athlete: { $ref: `${ref}111` } },
            { displayValue: '9', athlete: { $ref: 123 } },
          ],
        },
        { name: 'sacks', displayName: 'Sacks', leaders: [{ displayValue: '2', athlete: { $ref: `${ref}222` } }] },
      ],
    });

    const leaders = await fetchTeamStatLeaders(freshId(), DEFAULT_LEAGUE, 2026);

    expect(leaders).toEqual([
      { athleteId: '111', categoryName: 'Leader', category: 'Leader', displayValue: '', rank: 1 },
      { athleteId: '222', categoryName: 'sacks', category: 'Sacks', displayValue: '2', rank: 0 },
    ]);
  });

  it('fetchPlayerSeasonStats keeps only the season asked for, and only categories with signal', async () => {
    respondWith(playerStatsFixture);

    const categories = await fetchPlayerSeasonStats(freshId(), DEFAULT_LEAGUE, 2025);

    // receiving (2025, has signal) is kept. puntReturns is 2025 but all
    // zeroes; rushing has signal but is 2023.
    expect(categories.map((c) => c.name)).toEqual(['receiving']);
    expect(categories[0].values).toEqual(['76', '1315', '17.3', '15', '70']);
    expect(categories[0].descriptions[0]).toBe('Receptions');
  });

  // It was pinned to 2025 once, which outlived the 2026 season's first
  // games. The same athlete asked for another season has to be a different
  // cache entry, or the first year asked for is the only one ever shown.
  it('fetchPlayerSeasonStats answers for the season passed, per athlete and season', async () => {
    respondWith(playerStatsFixture);
    const id = freshId();

    const in2025 = await fetchPlayerSeasonStats(id, DEFAULT_LEAGUE, 2025);
    const in2023 = await fetchPlayerSeasonStats(id, DEFAULT_LEAGUE, 2023);

    expect(in2025.map((c) => c.name)).toEqual(['receiving']);
    expect(in2023.map((c) => c.name)).toEqual(['rushing']);
  });

  /**
   * Pinning current behavior, which doesn't quite match hasSignal's own
   * comment. The rule as coded is "drop it when *every* value is zero/blank",
   * so a line with a non-zero count but nothing gained survives — even though
   * the comment's example for what to drop is "a punt return line for a WR who
   * fielded one and gained nothing", which is exactly this. Worth deciding
   * which one is right; until then this documents what actually happens.
   */
  it('keeps a category with a non-zero count but no production', async () => {
    respondWith({
      categories: [
        {
          name: 'puntReturns',
          displayName: 'Punt Returns',
          labels: ['RET', 'YDS', 'TD'],
          statistics: [{ season: { year: 2025 }, stats: ['1', '0', '0'] }],
        },
      ],
    });

    const categories = await fetchPlayerSeasonStats(freshId(), DEFAULT_LEAGUE, 2025);

    expect(categories.map((c) => c.name)).toEqual(['puntReturns']);
  });

  it('fetchTeamSchedule resolves opponents and skips events without one', async () => {
    respondWith(scheduleFixture);

    const games = await fetchTeamSchedule('194', DEFAULT_LEAGUE);

    expect(games.map((g) => g.id)).toEqual(['401628461', '401628462', '401628999', '401629001', '401629002']);
    // A regulation win at home: ESPN's object-shaped score, its winner
    // flag, and the record the game left the team with.
    expect(games[0]).toMatchObject({
      opponentShortName: 'Michigan',
      homeAway: 'home',
      network: 'FOX',
      statusDetail: 'Final',
      statusShort: 'Final',
      state: 'post',
      completed: true,
      score: { own: 34, opponent: 10 },
      result: 'W',
      record: '1-0',
      odds: null,
    });
    // An overtime loss on the road: the score reads from our side even
    // though we are the second competitor, and the record is ours.
    expect(games[1]).toMatchObject({
      opponentShortName: 'Oregon',
      homeAway: 'away',
      statusShort: 'Final/OT',
      score: { own: 31, opponent: 34 },
      result: 'L',
      record: '1-1',
    });
    // neutralSite wins over the competitor's own homeAway. An upcoming game
    // carries no score, winner or record, and all three stay absent.
    expect(games[2]).toMatchObject({
      homeAway: 'neutral',
      completed: false,
      network: null,
      state: 'pre',
      statusShort: '12/6 - 3:00 PM EST',
      score: null,
      result: null,
      record: null,
    });
    // In progress: the schedule endpoint sends no score, winner or record
    // until the game is final.
    expect(games[3]).toMatchObject({
      state: 'in',
      statusShort: '3:12 - 3rd',
      score: null,
      result: null,
      record: null,
    });
    // Canceled: state "post" but never completed, with 0-0 scores and the
    // team's current record attached. None of it describes a game that was
    // played, so none of it comes through — this used to read as a 0-0 tie.
    expect(games[4]).toMatchObject({
      state: 'post',
      completed: false,
      statusShort: 'Canceled',
      score: null,
      result: null,
      record: null,
    });
  });

  it('fetchTeamSchedule degrades score, result and record to absent when they are the wrong types', async () => {
    respondWith({
      events: [
        {
          id: '1',
          date: '2025-09-01T00:00Z',
          competitions: [
            {
              competitors: [
                { homeAway: 'home', score: 'abc', winner: 'yes', record: 'nope', team: { id: 'x', displayName: 'X', shortDisplayName: 'X' } },
                { homeAway: 'away', score: [1], winner: 1, team: { id: 'y', displayName: 'Y', shortDisplayName: 'Y' } },
              ],
              status: { type: { state: 7, shortDetail: 9, completed: true } },
            },
          ],
        },
        {
          // A record that is an array of junk rather than not an array at all.
          id: '2',
          date: '2025-09-08T00:00Z',
          competitions: [
            {
              competitors: [
                { homeAway: 'home', record: [{ type: 5 }, { type: 'total', displayValue: 7 }], team: { id: 'x', displayName: 'X', shortDisplayName: 'X' } },
                { homeAway: 'away', team: { id: 'y', displayName: 'Y', shortDisplayName: 'Y' } },
              ],
              status: { type: { completed: true } },
            },
          ],
        },
      ],
    });

    const games = await fetchTeamSchedule('x', DEFAULT_LEAGUE, { force: true });

    // `completed` still says it is over, so the state follows it — but with
    // no usable score and no real winner flag there is no result to show.
    expect(games[0]).toMatchObject({ state: 'post', statusShort: '', score: null, result: null, record: null });
    expect(games[1].record).toBeNull();
  });

  it('competitorScore reads the schedule object, the scoreboard string, and nothing else', () => {
    expect(competitorScore({ value: 56, displayValue: '56' })).toBe(56);
    expect(competitorScore({ value: '21' })).toBe(21);
    expect(competitorScore('33')).toBe(33);
    expect(competitorScore(0)).toBe(0);
    expect(competitorScore({ displayValue: '7' })).toBeNull();
    expect(competitorScore({ value: 'abc' })).toBeNull();
    expect(competitorScore(null)).toBeNull();
    expect(competitorScore([1])).toBeNull();
  });

  it('gameResult trusts winner flags first and falls back to the score', () => {
    const side = (winner: unknown, score: number | null) => ({ winner, score });
    expect(gameResult(side(true, 23), side(false, 24))).toBe('W'); // a flag outranks the score (forfeit)
    expect(gameResult(side(false, 30), side(true, 10))).toBe('L');
    expect(gameResult(side(undefined, 21), side(undefined, 14))).toBe('W');
    expect(gameResult(side(undefined, 14), side(undefined, 21))).toBe('L');
    // Every loser carries winner:false, so two of them with equal scores is a tie.
    expect(gameResult(side(false, 17), side(false, 17))).toBe('T');
    expect(gameResult(side('yes', null), side(undefined, 3))).toBeNull();
  });

  it('fetchTeamArticles drops articles with no web link and normalises dates', async () => {
    respondWith(teamNewsFixture);

    const articles = await fetchTeamArticles(freshId(), DEFAULT_LEAGUE);

    expect(articles).toHaveLength(2);
    expect(articles[0].publishedAt).toBe('2025-11-29T22:14:00.000Z');
    // An unparseable date becomes null rather than an Invalid Date.
    expect(articles[1].publishedAt).toBeNull();
    expect(articles.map((a) => a.title)).not.toContain(
      'This one has no web link and should be dropped',
    );
  });

  it('fetchLeagueArticles parses the same shape league-wide and asks for a real limit', async () => {
    respondWith(teamNewsFixture);

    const articles = await fetchLeagueArticles(DEFAULT_LEAGUE);

    // Same response shape as the team-scoped endpoint, same rules: the
    // linkless article is dropped, dates normalise, metadata is ESPN's.
    expect(articles).toHaveLength(2);
    expect(articles[0]).toMatchObject({ source: 'ESPN', tier: 1, reach: 'national', scope: 'broad' });
    expect(articles.map((a) => a.title)).not.toContain(
      'This one has no web link and should be dropped',
    );
    // The no-limit default is only 6 items — the explicit limit is what
    // restores parity with the retired RSS feed, so pin its presence.
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(String(fetchMock.mock.calls[0][0])).toContain('/football/college-football/news?limit=');
  });

  it('fetchTeamColor prefixes the hex and rejects white', async () => {
    respondWith(teamFixture);
    await expect(fetchTeamColor(freshId(), DEFAULT_LEAGUE)).resolves.toBe('#bb0000');

    respondWith({ team: { color: 'FFFFFF' } });
    await expect(fetchTeamColor(freshId(), DEFAULT_LEAGUE)).resolves.toBeNull();
  });
});

describe('ESPN parsers on a non-OK response', () => {
  it('fetchPlayerSeasonStats degrades to empty', async () => {
    respondWith(null, { ok: false, status: 503 });
    await expect(fetchPlayerSeasonStats(freshId(), DEFAULT_LEAGUE, 2025)).resolves.toEqual([]);
  });

  // The leaders are the Players tab's whole content, so an empty result
  // renders as "No stat leaders yet this season". A failure has to throw
  // instead, and stay uncached, or that false line outlives the outage.
  it('fetchTeamStatLeaders throws on a failed response, and the next call retries', async () => {
    const id = freshId();

    respondWith(null, { ok: false, status: 503 });
    await expect(fetchTeamStatLeaders(id, DEFAULT_LEAGUE, 2026)).rejects.toThrow('503');

    respondWith(teamLeadersFixture);
    await expect(fetchTeamStatLeaders(id, DEFAULT_LEAGUE, 2026)).resolves.toHaveLength(4);
  });

  // ESPN's real answer for a season with no games yet.
  it('fetchTeamStatLeaders reads a 404 as a season with no leaders yet', async () => {
    respondWith({ error: { message: 'No stats found.', code: 404 } }, { ok: false, status: 404 });
    await expect(fetchTeamStatLeaders(freshId(), DEFAULT_LEAGUE, 2027)).resolves.toEqual([]);
  });

  it('fetchTeamStatLeaders keeps each season in its own cache entry', async () => {
    const id = freshId();

    respondWith(teamLeadersFixture);
    await expect(fetchTeamStatLeaders(id, DEFAULT_LEAGUE, 2025)).resolves.toHaveLength(4);

    // Not served last season's four: a fresh request for the new year.
    respondWith({ categories: [] });
    await expect(fetchTeamStatLeaders(id, DEFAULT_LEAGUE, 2026)).resolves.toEqual([]);
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(String(fetchMock.mock.calls[0][0])).toContain('/seasons/2026/');
  });

  it('fetchTeamColor and fetchGameOdds degrade to null', async () => {
    respondWith(null, { ok: false, status: 503 });
    await expect(fetchTeamColor(freshId(), DEFAULT_LEAGUE)).resolves.toBeNull();
    await expect(fetchGameOdds(freshId(), DEFAULT_LEAGUE)).resolves.toBeNull();
  });

  /**
   * The deliberate exception documented in AGENTS.md: no team list means no
   * app, so this surfaces a retryable error instead of an empty screen that
   * looks like it loaded correctly.
   */
  it('fetchTeams throws, by design', async () => {
    respondWith(null, { ok: false, status: 503 });
    await expect(fetchTeams(DEFAULT_LEAGUE, { force: true })).rejects.toThrow(/Big Ten team list responded 503/);
  });

  it.each([
    ['fetchTeamRoster', () => fetchTeamRoster(freshId(), DEFAULT_LEAGUE)],
    ['fetchTeamSchedule', () => fetchTeamSchedule(freshId(), DEFAULT_LEAGUE)],
    ['fetchTeamArticles', () => fetchTeamArticles(freshId(), DEFAULT_LEAGUE)],
    ['fetchLeagueArticles', () => fetchLeagueArticles(DEFAULT_LEAGUE)],
    // A live poll that fails should retry on the next tick, not cache a
    // board with no games or a summary with no drives for the TTL.
    ['fetchScoreboard', () => fetchScoreboard(DEFAULT_LEAGUE, { force: true })],
    ['fetchGameSummary', () => fetchGameSummary(freshId(), DEFAULT_LEAGUE)],
  ])('%s throws so the caller can show an error state', async (_name, call) => {
    respondWith(null, { ok: false, status: 503 });
    await expect(call()).rejects.toThrow(/responded 503/);
  });
});
