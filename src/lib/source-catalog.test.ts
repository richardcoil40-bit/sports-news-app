import { afterEach, describe, expect, it, vi } from 'vitest';

import rssValidXml from '@/lib/__fixtures__/rss-valid.xml?raw';
import { DEFAULT_LEAGUE, getLeague } from '@/lib/league-catalog';
import { League } from '@/lib/leagues';
import {
  espnLeagueNewsFor,
  fetchLeagueFeeds,
  leaguesWithNationalFeeds,
  nationalFeedsFor,
  teamSourcesFor,
} from '@/lib/source-catalog';

/**
 * The contract worth protecting here is that curated sources are *optional*.
 * Every URL in community-sources.ts was verified by hand, so the real cost of
 * a second league is research — and a league nobody has done that research
 * for has to be a normal, working state rather than a crash or an empty app.
 */
const UNCURATED: League = {
  id: 'league-with-no-sources',
  displayName: 'Uncurated',
  espnSport: 'basketball',
  espnLeaguePath: 'nba',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a league with no curated sources', () => {
  it('has no national feeds', () => {
    expect(nationalFeedsFor(UNCURATED)).toEqual([]);
  });

  it('has no team sources', () => {
    expect(teamSourcesFor(UNCURATED, 'Lakers')).toEqual([]);
  });

  it('does not get ESPN league news either — a present key is a decision', () => {
    expect(espnLeagueNewsFor(UNCURATED)).toBe(false);
  });

  it('resolves to an empty pool without touching the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchLeagueFeeds(UNCURATED)).resolves.toEqual({
      articles: [],
      failedSources: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is left out of the periodic refresh', () => {
    expect(leaguesWithNationalFeeds().map((l) => l.id)).not.toContain(UNCURATED.id);
  });
});

/**
 * The SEC is the second curated league, and the first thing to prove is
 * that the two are actually distinct — a shared national array and a
 * shared slug helper are exactly the shapes that quietly collapse into
 * one league serving the other's coverage.
 */
const SEC = getLeague('sec')!;

describe('two curated leagues', () => {
  it('share the sport-wide feeds', () => {
    const bigTen = new Set(nationalFeedsFor(DEFAULT_LEAGUE).map((s) => s.id));
    expect(nationalFeedsFor(SEC).filter((s) => bigTen.has(s.id)).map((s) => s.id)).toContain(
      'cbs-cfb',
    );
  });

  it('each carry their own conference-wide blog and not the other\'s', () => {
    expect(nationalFeedsFor(DEFAULT_LEAGUE).map((s) => s.id)).toContain('off-tackle-empire');
    expect(nationalFeedsFor(SEC).map((s) => s.id)).toContain('saturday-down-south');
    expect(nationalFeedsFor(SEC).map((s) => s.id)).not.toContain('off-tackle-empire');
  });

  it('resolve team sources from their own table only', () => {
    expect(teamSourcesFor(SEC, 'Alabama').length).toBeGreaterThan(0);
    // Michigan is a real slug in the Big Ten table — the SEC must not
    // reach it, or two conferences sharing one map would go unnoticed.
    expect(teamSourcesFor(SEC, 'Michigan')).toEqual([]);
    expect(teamSourcesFor(DEFAULT_LEAGUE, 'Alabama')).toEqual([]);
  });

  it('resolve the short names ESPN abbreviates', () => {
    expect(teamSourcesFor(SEC, 'Mississippi St').length).toBeGreaterThan(0);
    expect(teamSourcesFor(SEC, 'Texas A&M').length).toBeGreaterThan(0);
  });

  it('tag SEC team sources as beat coverage too', () => {
    expect(teamSourcesFor(SEC, 'Alabama').every((s) => s.reach === 'beat')).toBe(true);
  });

  it('are both in the periodic refresh', () => {
    expect(leaguesWithNationalFeeds().map((l) => l.id)).toEqual(
      expect.arrayContaining(['big-ten', 'sec']),
    );
  });
});

describe('the curated league', () => {
  it('has national feeds', () => {
    expect(nationalFeedsFor(DEFAULT_LEAGUE).length).toBeGreaterThan(0);
  });

  it('resolves team sources by short name', () => {
    expect(teamSourcesFor(DEFAULT_LEAGUE, 'Michigan').length).toBeGreaterThan(0);
  });

  // Community sources are beat coverage by definition; the tag is applied in
  // one place so a source added later can't be left untagged and filed as
  // national.
  it('tags every team source as beat coverage', () => {
    const sources = teamSourcesFor(DEFAULT_LEAGUE, 'Michigan');
    expect(sources.every((s) => s.reach === 'beat')).toBe(true);
  });

  it('returns nothing for a team it has no sources for', () => {
    expect(teamSourcesFor(DEFAULT_LEAGUE, 'Not A Real Team')).toEqual([]);
  });

  it('is included in the periodic refresh', () => {
    expect(leaguesWithNationalFeeds().map((l) => l.id)).toContain(DEFAULT_LEAGUE.id);
  });
});

/**
 * The national pool is two halves — the curated RSS list and ESPN's
 * league-wide JSON news, merged. (ESPN's RSS entry answered 202 with an
 * empty body more often than not; see docs/evidence/README.md.) Each
 * scenario below uses a different real league id because the pool caches
 * per league at module scope with no reset hook.
 */
const NFL = getLeague('nfl')!;
const BIG_12 = getLeague('big-12')!;

const ESPN_JSON = {
  articles: [
    {
      id: 99001,
      headline: 'League-wide story from ESPN',
      links: { web: { href: 'https://www.espn.com/story/99001' } },
      published: '2026-08-25T12:00:00Z',
    },
  ],
};

const isEspnJson = (url: string) => url.includes('site.api.espn.com');

/** Serves text() for the RSS half and json() for the ESPN half. */
function respondByUrl(rule: (url: string) => { status: number; body: string | object }) {
  const fetchMock = vi.fn(async (url: string) => {
    const { status, body } = rule(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('espnLeagueNewsFor', () => {
  it('is on for every shipped league', () => {
    for (const id of ['big-ten', 'sec', 'big-12', 'nfl']) {
      expect(espnLeagueNewsFor(getLeague(id)!)).toBe(true);
    }
  });
});

describe('the merged national pool', () => {
  it('serves RSS and ESPN league news together — the NFL was ESPN-less before', async () => {
    const fetchMock = respondByUrl((url) =>
      isEspnJson(url) ? { status: 200, body: ESPN_JSON } : { status: 200, body: rssValidXml },
    );

    const { articles, failedSources } = await fetchLeagueFeeds(NFL, { force: true });

    expect(failedSources).toEqual([]);
    expect(articles.some((a) => a.source === 'ESPN')).toBe(true);
    expect(articles.some((a) => a.source !== 'ESPN')).toBe(true);
    const espnCall = fetchMock.mock.calls.map((c) => String(c[0])).find(isEspnJson);
    expect(espnCall).toContain('/football/nfl/news?limit=');
  });

  it('keeps the RSS half and reports ESPN when the JSON side fails', async () => {
    respondByUrl((url) =>
      isEspnJson(url) ? { status: 500, body: '' } : { status: 200, body: rssValidXml },
    );

    const { articles, failedSources } = await fetchLeagueFeeds(SEC, { force: true });

    expect(articles.length).toBeGreaterThan(0);
    expect(articles.every((a) => a.source !== 'ESPN')).toBe(true);
    // The exact name the retired RSS entry reported under, so downstream
    // display of failed sources is unchanged.
    expect(failedSources).toEqual(['ESPN']);
  });

  it('keeps the ESPN half when every RSS source fails', async () => {
    respondByUrl((url) =>
      isEspnJson(url) ? { status: 200, body: ESPN_JSON } : { status: 500, body: '' },
    );

    const { articles, failedSources } = await fetchLeagueFeeds(DEFAULT_LEAGUE, { force: true });

    expect(articles.map((a) => a.source)).toEqual(['ESPN']);
    expect([...failedSources].sort()).toEqual([
      'CBS Sports',
      'Extra Points',
      'Off Tackle Empire',
      'Yahoo Sports',
    ]);
  });

  it('caches the merged result as one pool entry', async () => {
    const fetchMock = respondByUrl((url) =>
      isEspnJson(url) ? { status: 200, body: ESPN_JSON } : { status: 200, body: rssValidXml },
    );

    await fetchLeagueFeeds(BIG_12);
    const callsAfterFirst = fetchMock.mock.calls.length;
    await fetchLeagueFeeds(BIG_12);

    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });
});
