import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LEAGUE,
  getCatalogLeagues,
  getLeague,
  getLeagues,
  parseLeagues,
} from '@/lib/league-catalog';

/**
 * `parseLeagues` is the gate a remote catalog will eventually come through,
 * so it is tested as if the input were already hostile. The contract that
 * matters: one bad entry must never cost the user the good ones, and a
 * document it can't read at all must produce an empty list rather than a
 * throw, so the caller can fall back.
 */

const VALID = {
  id: 'big-12',
  displayName: 'Big 12',
  espnSport: 'football',
  espnLeaguePath: 'college-football',
  espnGroup: 4,
  seasonStartMonth: 8,
};

describe('parseLeagues — picker taxonomy', () => {
  it('keeps sport and level when present', () => {
    const [league] = parseLeagues([{ ...VALID, sport: 'Football', level: 'College' }]);
    expect(league.sport).toBe('Football');
    expect(league.level).toBe('College');
  });

  it('keeps a league that declares neither, rather than dropping it', () => {
    const [league] = parseLeagues([VALID]);
    expect(league.id).toBe('big-12');
    expect(league.sport).toBeUndefined();
  });

  it('marks a planned league and treats anything else as available', () => {
    const [planned] = parseLeagues([{ ...VALID, status: 'planned' }]);
    expect(planned.status).toBe('planned');

    // A typo in a field unrelated to whether the league works must not
    // be able to hide a working league.
    const [junk] = parseLeagues([{ ...VALID, status: 'plnned' }]);
    expect(junk.status).toBeUndefined();
  });
});

describe('the bundled catalog', () => {
  it('offers only leagues the app can actually serve', () => {
    expect(getLeagues().every((league) => league.status !== 'planned')).toBe(true);
  });

  it('shows planned leagues to the picker', () => {
    const planned = getCatalogLeagues().filter((league) => league.status === 'planned');
    expect(planned.length).toBeGreaterThan(0);
    expect(getLeagues()).not.toEqual(getCatalogLeagues());
  });

  it('never defaults to a planned league', () => {
    expect(DEFAULT_LEAGUE.status).toBeUndefined();
  });
});

describe('parseLeagues', () => {
  it('parses a well-formed catalog', () => {
    expect(parseLeagues([VALID])).toEqual([VALID]);
  });

  it('keeps a league that omits the optional fields', () => {
    const minimal = {
      id: 'nfl',
      displayName: 'NFL',
      espnSport: 'football',
      espnLeaguePath: 'nfl',
    };

    expect(parseLeagues([minimal])).toEqual([
      { ...minimal, espnGroup: undefined, seasonStartMonth: undefined },
    ]);
  });

  it('trims whitespace off the strings it keeps', () => {
    const padded = { ...VALID, id: '  big-12  ', displayName: '  Big 12  ' };
    const [league] = parseLeagues([padded]);

    expect(league.id).toBe('big-12');
    expect(league.displayName).toBe('Big 12');
  });

  // The rule that matters most: partial failure, not total failure.
  it('drops only the invalid entries and keeps the rest', () => {
    const parsed = parseLeagues([
      VALID,
      { id: 'broken' }, // missing everything else
      { ...VALID, id: 'acc', displayName: 'ACC' },
    ]);

    expect(parsed.map((l) => l.id)).toEqual(['big-12', 'acc']);
  });

  describe('rejects an entry missing a required field', () => {
    const required = ['id', 'displayName', 'espnSport', 'espnLeaguePath'] as const;

    for (const field of required) {
      it(`without ${field}`, () => {
        const broken: Record<string, unknown> = { ...VALID };
        delete broken[field];
        expect(parseLeagues([broken])).toEqual([]);
      });

      it(`with an empty ${field}`, () => {
        expect(parseLeagues([{ ...VALID, [field]: '   ' }])).toEqual([]);
      });

      it(`with a non-string ${field}`, () => {
        expect(parseLeagues([{ ...VALID, [field]: 42 }])).toEqual([]);
      });
    }
  });

  // A bad optional field costs a wrong stats year; rejecting the league
  // costs every team in it. The cheaper failure is the right one.
  describe('drops a malformed optional field but keeps the league', () => {
    const cases: [string, unknown, 'espnGroup' | 'seasonStartMonth'][] = [
      ['a string group', '5', 'espnGroup'],
      ['a fractional group', 5.5, 'espnGroup'],
      ['a month above December', 12, 'seasonStartMonth'],
      ['a negative month', -1, 'seasonStartMonth'],
      ['a fractional month', 7.5, 'seasonStartMonth'],
      ['a null month', null, 'seasonStartMonth'],
    ];

    for (const [label, value, field] of cases) {
      it(label, () => {
        const [league] = parseLeagues([{ ...VALID, [field]: value }]);
        expect(league).toBeDefined();
        expect(league[field]).toBeUndefined();
      });
    }
  });

  // Ids are cache keys. Two leagues answering to one id would serve each
  // other's team lists.
  it('keeps the first of two entries sharing an id', () => {
    const parsed = parseLeagues([VALID, { ...VALID, displayName: 'Impostor' }]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].displayName).toBe('Big 12');
  });

  describe('returns [] for a document it cannot read', () => {
    const junk: [string, unknown][] = [
      ['null', null],
      ['undefined', undefined],
      ['a string', 'nope'],
      ['a number', 7],
      ['an object instead of an array', { leagues: [VALID] }],
      ['an empty array', []],
      ['an array of junk', [null, 'x', 3, []]],
    ];

    for (const [label, value] of junk) {
      it(label, () => {
        expect(parseLeagues(value)).toEqual([]);
      });
    }
  });
});

describe('the bundled catalog', () => {
  it('is non-empty and parses', () => {
    expect(getLeagues().length).toBeGreaterThan(0);
  });

  it('exposes the first entry as the default', () => {
    expect(DEFAULT_LEAGUE).toEqual(getLeagues()[0]);
  });

  it('looks a league up by id, and returns null for an unknown one', () => {
    expect(getLeague(DEFAULT_LEAGUE.id)).toEqual(DEFAULT_LEAGUE);
    expect(getLeague('not-a-league')).toBeNull();
  });

  // Guards the shipped data itself, not just the parser: these are the
  // fields every URL in the app is built from.
  it('ships a league the ESPN URL builders can use', () => {
    expect(DEFAULT_LEAGUE.espnSport).toBeTruthy();
    expect(DEFAULT_LEAGUE.espnLeaguePath).toBeTruthy();
  });
});
