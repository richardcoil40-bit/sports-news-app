import { describe, expect, it } from 'vitest';

import { favoriteKey, migrateFavoriteIds, parseFavoriteKey } from '@/lib/favorite-keys';

/**
 * This is persisted user data with no server behind it, so the migration has
 * to keep working for as long as any device might still hold the old format.
 * A user who skips five versions still arrives here with bare ids.
 */

describe('favoriteKey / parseFavoriteKey', () => {
  it('round-trips', () => {
    const key = favoriteKey('big-ten', '130');
    expect(key).toBe('big-ten:130');
    expect(parseFavoriteKey(key)).toEqual({ leagueId: 'big-ten', teamId: '130' });
  });

  // ESPN ids aren't ours to make guarantees about, so anything after the
  // first colon is the team id rather than being silently truncated.
  it('splits on the first separator only', () => {
    expect(parseFavoriteKey('big-ten:a:b')).toEqual({ leagueId: 'big-ten', teamId: 'a:b' });
  });

  describe('rejects a malformed key', () => {
    const bad = [
      ['no separator', '130'],
      ['empty league', ':130'],
      ['empty team', 'big-ten:'],
      ['just a separator', ':'],
      ['empty string', ''],
    ] as const;

    for (const [label, value] of bad) {
      it(label, () => {
        expect(parseFavoriteKey(value)).toBeNull();
      });
    }
  });
});

describe('migrateFavoriteIds', () => {
  // The actual upgrade: bare ESPN ids could only have been written when the
  // app had a single league, so that league is the right owner for them.
  it('qualifies bare ids with the fallback league', () => {
    expect(migrateFavoriteIds(['130', '194'], 'big-ten')).toEqual([
      'big-ten:130',
      'big-ten:194',
    ]);
  });

  it('leaves already-qualified keys alone', () => {
    expect(migrateFavoriteIds(['big-ten:130'], 'big-ten')).toEqual(['big-ten:130']);
  });

  it('does not re-qualify a key from another league', () => {
    expect(migrateFavoriteIds(['nfl:12'], 'big-ten')).toEqual(['nfl:12']);
  });

  it('handles a mix of both formats', () => {
    expect(migrateFavoriteIds(['130', 'nfl:12'], 'big-ten')).toEqual([
      'big-ten:130',
      'nfl:12',
    ]);
  });

  // Migration must be idempotent: it runs on every launch until the upgraded
  // value is written back, and a failed write means it runs again.
  it('is idempotent', () => {
    const once = migrateFavoriteIds(['130'], 'big-ten');
    expect(migrateFavoriteIds(once, 'big-ten')).toEqual(once);
  });

  // A bare id and its qualified form are the same team. Keeping both would
  // render the row twice and double-count the team in the feed.
  it('collapses a bare id and its qualified equivalent', () => {
    expect(migrateFavoriteIds(['130', 'big-ten:130'], 'big-ten')).toEqual(['big-ten:130']);
  });

  it('preserves order', () => {
    expect(migrateFavoriteIds(['194', '130', '213'], 'big-ten')).toEqual([
      'big-ten:194',
      'big-ten:130',
      'big-ten:213',
    ]);
  });

  // This value survives app upgrades, so a future version writing a shape
  // this one doesn't understand must not be able to crash it on launch.
  describe('drops junk without throwing', () => {
    const cases: [string, unknown][] = [
      ['not an array', { '0': '130' }],
      ['null', null],
      ['undefined', undefined],
      ['a string', '130'],
      ['a number', 130],
    ];

    for (const [label, value] of cases) {
      it(label, () => {
        expect(migrateFavoriteIds(value, 'big-ten')).toEqual([]);
      });
    }

    it('mixed junk inside a valid array', () => {
      expect(migrateFavoriteIds(['130', null, 42, '', '   ', {}, '194'], 'big-ten')).toEqual([
        'big-ten:130',
        'big-ten:194',
      ]);
    });
  });
});
