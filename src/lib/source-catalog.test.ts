import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LEAGUE, getLeague } from '@/lib/league-catalog';
import { League } from '@/lib/leagues';
import {
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
      'espn-cfb',
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
