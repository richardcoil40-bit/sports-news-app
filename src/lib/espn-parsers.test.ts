import { afterEach, describe, expect, it, vi } from 'vitest';

import playerStatsFixture from '@/lib/__fixtures__/espn-player-stats.json';
import rosterFixture from '@/lib/__fixtures__/espn-roster.json';
import scheduleFixture from '@/lib/__fixtures__/espn-schedule.json';
import standingsFixture from '@/lib/__fixtures__/espn-standings.json';
import teamFixture from '@/lib/__fixtures__/espn-team.json';
import teamLeadersFixture from '@/lib/__fixtures__/espn-team-leaders.json';
import teamNewsFixture from '@/lib/__fixtures__/espn-team-news.json';
import { BIG_TEN } from '@/lib/leagues';
import { fetchPlayerSeasonStats } from '@/lib/player-stats';
import { fetchTeamRoster } from '@/lib/roster';
import { fetchGameOdds, fetchTeamSchedule } from '@/lib/schedule';
import { fetchTeamColor } from '@/lib/team-color';
import { fetchTeamStatLeaders } from '@/lib/team-leaders';
import { fetchTeamArticles } from '@/lib/team-news';
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
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ESPN parsers degrade to empty on a malformed response', () => {
  const emptyArrayParsers: [string, (id: string) => Promise<unknown[]>][] = [
    ['fetchTeamRoster', fetchTeamRoster],
    ['fetchTeamSchedule', fetchTeamSchedule],
    ['fetchTeamArticles', fetchTeamArticles],
    ['fetchTeamStatLeaders', fetchTeamStatLeaders],
    ['fetchPlayerSeasonStats', fetchPlayerSeasonStats],
  ];

  for (const [name, parser] of emptyArrayParsers) {
    describe(name, () => {
      for (const [label, body] of MALFORMED_SHAPES) {
        it(`returns [] for ${label}`, async () => {
          respondWith(body);
          await expect(parser(freshId())).resolves.toEqual([]);
        });
      }
    });
  }

  describe('fetchTeamColor', () => {
    for (const [label, body] of MALFORMED_SHAPES) {
      it(`returns null for ${label}`, async () => {
        respondWith(body);
        await expect(fetchTeamColor(freshId())).resolves.toBeNull();
      });
    }
  });

  describe('fetchGameOdds', () => {
    for (const [label, body] of MALFORMED_SHAPES) {
      it(`returns null for ${label}`, async () => {
        respondWith(body);
        await expect(fetchGameOdds(freshId())).resolves.toBeNull();
      });
    }
  });

  describe('fetchTeams', () => {
    for (const [label, body] of MALFORMED_SHAPES) {
      it(`returns [] for ${label}`, async () => {
        respondWith(body);
        // force, because the team list caches per league rather than per id.
        await expect(fetchTeams(BIG_TEN, { force: true })).resolves.toEqual([]);
      });
    }
  });
});

describe('ESPN parsers on a well-formed response', () => {
  it('fetchTeams maps standings entries and sorts by short name', async () => {
    respondWith(standingsFixture);

    const teams = await fetchTeams(BIG_TEN, { force: true });

    expect(teams.map((t) => t.shortName)).toEqual(['Michigan', 'Ohio State', 'Penn State']);
    expect(teams[1]).toEqual({
      id: '194',
      name: 'Ohio State Buckeyes',
      shortName: 'Ohio State',
      abbreviation: 'OSU',
      logoUrl: 'https://a.espncdn.com/i/teamlogos/ncaa/500/194.png',
    });
    // Penn State has no logos array in the fixture.
    expect(teams[2].logoUrl).toBeNull();
  });

  it('fetchTeamRoster keeps only real position groups', async () => {
    respondWith(rosterFixture);

    const players = await fetchTeamRoster(freshId());

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

    const leaders = await fetchTeamStatLeaders(freshId());

    expect(leaders).toHaveLength(3);
    expect(leaders[0]).toEqual({
      athleteId: '4432762',
      category: 'Passing Leader',
      displayValue: '3,323',
      rank: 0,
    });
    expect(leaders[1].rank).toBe(1);
    // The third category's $ref has no athlete id, so it's dropped entirely.
    expect(leaders.map((l) => l.category)).not.toContain('Receiving Leader');
  });

  it('fetchPlayerSeasonStats keeps only the pinned season, and only categories with signal', async () => {
    respondWith(playerStatsFixture);

    const categories = await fetchPlayerSeasonStats(freshId());

    // receiving (2025, has signal) is kept. puntReturns is 2025 but all
    // zeroes; rushing has signal but is 2023.
    expect(categories.map((c) => c.name)).toEqual(['receiving']);
    expect(categories[0].values).toEqual(['76', '1315', '17.3', '15', '70']);
    expect(categories[0].descriptions[0]).toBe('Receptions');
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

    const categories = await fetchPlayerSeasonStats(freshId());

    expect(categories.map((c) => c.name)).toEqual(['puntReturns']);
  });

  it('fetchTeamSchedule resolves opponents and skips events without one', async () => {
    respondWith(scheduleFixture);

    const games = await fetchTeamSchedule('194');

    expect(games).toHaveLength(2);
    expect(games[0]).toMatchObject({
      id: '401628461',
      opponentShortName: 'Michigan',
      homeAway: 'home',
      network: 'FOX',
      statusDetail: 'Final: W 34-10',
      completed: true,
      odds: null,
    });
    // neutralSite wins over the competitor's own homeAway.
    expect(games[1].homeAway).toBe('neutral');
    expect(games[1].completed).toBe(false);
    expect(games[1].network).toBeNull();
  });

  it('fetchTeamArticles drops articles with no web link and normalises dates', async () => {
    respondWith(teamNewsFixture);

    const articles = await fetchTeamArticles(freshId());

    expect(articles).toHaveLength(2);
    expect(articles[0].publishedAt).toBe('2025-11-29T22:14:00.000Z');
    // An unparseable date becomes null rather than an Invalid Date.
    expect(articles[1].publishedAt).toBeNull();
    expect(articles.map((a) => a.title)).not.toContain(
      'This one has no web link and should be dropped',
    );
  });

  it('fetchTeamColor prefixes the hex and rejects white', async () => {
    respondWith(teamFixture);
    await expect(fetchTeamColor(freshId())).resolves.toBe('#bb0000');

    respondWith({ team: { color: 'FFFFFF' } });
    await expect(fetchTeamColor(freshId())).resolves.toBeNull();
  });
});

describe('ESPN parsers on a non-OK response', () => {
  it.each([
    ['fetchTeamStatLeaders', () => fetchTeamStatLeaders(freshId()), []],
    ['fetchPlayerSeasonStats', () => fetchPlayerSeasonStats(freshId()), []],
  ])('%s degrades to empty', async (_name, call, expected) => {
    respondWith(null, { ok: false, status: 503 });
    await expect(call()).resolves.toEqual(expected);
  });

  it('fetchTeamColor and fetchGameOdds degrade to null', async () => {
    respondWith(null, { ok: false, status: 503 });
    await expect(fetchTeamColor(freshId())).resolves.toBeNull();
    await expect(fetchGameOdds(freshId())).resolves.toBeNull();
  });

  /**
   * The deliberate exception documented in AGENTS.md: no team list means no
   * app, so this surfaces a retryable error instead of an empty screen that
   * looks like it loaded correctly.
   */
  it('fetchTeams throws, by design', async () => {
    respondWith(null, { ok: false, status: 503 });
    await expect(fetchTeams(BIG_TEN, { force: true })).rejects.toThrow(/Big Ten team list responded 503/);
  });

  it.each([
    ['fetchTeamRoster', () => fetchTeamRoster(freshId())],
    ['fetchTeamSchedule', () => fetchTeamSchedule(freshId())],
    ['fetchTeamArticles', () => fetchTeamArticles(freshId())],
  ])('%s throws so the caller can show an error state', async (_name, call) => {
    respondWith(null, { ok: false, status: 503 });
    await expect(call()).rejects.toThrow(/responded 503/);
  });
});
