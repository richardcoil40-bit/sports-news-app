import { describe, expect, it } from 'vitest';

import { League } from '@/lib/leagues';
import { allPlanned, leaguesIn, levelsIn, sportsIn, UNFILED } from '@/lib/league-taxonomy';

const league = (over: Partial<League> & { id: string }): League => ({
  displayName: over.id,
  espnSport: 'football',
  espnLeaguePath: 'college-football',
  ...over,
});

const CATALOG: League[] = [
  league({ id: 'big-ten', sport: 'Football', level: 'College' }),
  league({ id: 'sec', sport: 'Football', level: 'College' }),
  league({ id: 'nfl', sport: 'Football', level: 'NFL', status: 'planned' }),
  league({ id: 'nba', sport: 'Basketball', level: 'Pro', status: 'planned' }),
];

describe('league taxonomy', () => {
  it('lists each sport once, in catalog order', () => {
    expect(sportsIn(CATALOG)).toEqual(['Football', 'Basketball']);
  });

  it('lists the levels within one sport', () => {
    expect(levelsIn(CATALOG, 'Football')).toEqual(['College', 'NFL']);
  });

  it('lists the leagues within one level', () => {
    expect(leaguesIn(CATALOG, 'Football', 'College').map((l) => l.id)).toEqual(['big-ten', 'sec']);
  });

  // The catalog is the eventual remote document, so a league that arrives
  // without a taxonomy must still be reachable rather than disappearing.
  it('files a league declaring neither sport nor level under Other', () => {
    const catalog = [...CATALOG, league({ id: 'mystery' })];
    expect(sportsIn(catalog)).toContain(UNFILED);
    expect(leaguesIn(catalog, UNFILED, UNFILED).map((l) => l.id)).toEqual(['mystery']);
  });

  describe('allPlanned', () => {
    it('is true when nothing under a node can be served', () => {
      expect(allPlanned(leaguesIn(CATALOG, 'Football', 'NFL'))).toBe(true);
    });

    it('is false when anything under it can be', () => {
      expect(allPlanned(leaguesIn(CATALOG, 'Football', 'College'))).toBe(false);
    });

    // An empty node is not a planned one — nothing is coming, so the
    // "not available yet" note would be a promise the catalog never made.
    it('is false for an empty node', () => {
      expect(allPlanned([])).toBe(false);
    });
  });
});
