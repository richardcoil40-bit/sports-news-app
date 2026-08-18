import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LEAGUE } from '@/lib/league-catalog';
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
