import { describe, expect, it } from 'vitest';

import { curatedTeams, nicknameHazards, nicknamesAreReachable, reservedNames } from '@/lib/nickname-safety';
import type { CuratedTeam, ReservedName } from '@/lib/nickname-safety';

/**
 * Synthetic teams, deliberately.
 *
 * team-review.test.ts asserts that the shipped tables produce no hazards,
 * and that assertion is only worth anything if this file proves the
 * detector can produce one. A checker that always answers "nothing wrong"
 * passes an empty-list assertion perfectly.
 *
 * The cases below are the real ones with the names changed: two schools
 * sharing a mascot and a metro paper, two sharing a mascot across the
 * country from each other, and a word a professional team owns.
 */
const team = (overrides: Partial<CuratedTeam> & { slug: string }): CuratedTeam => ({
  name: overrides.slug,
  nicknames: [],
  broadSourceIds: [],
  ...overrides,
});

describe('a collision matters when the sources overlap', () => {
  it('fails two teams that claim one word through a source they share', () => {
    const hazards = nicknameHazards(
      [
        team({ slug: 'north-school', nicknames: ['Wildcats'], broadSourceIds: ['metro-paper'] }),
        team({ slug: 'south-school', nicknames: ['Wildcats'], broadSourceIds: ['metro-paper'] }),
      ],
      [],
    );

    expect(hazards.map((hazard) => hazard.kind)).toEqual(['shared-source', 'shared-source']);
    expect(hazards[0].detail).toContain('metro-paper');
  });

  // The rule the whole module exists for: the word is identical in both
  // tests, and only the sources changed.
  it('only notes two teams that claim one word through different sources', () => {
    const hazards = nicknameHazards(
      [
        team({ slug: 'north-school', nicknames: ['Wildcats'], broadSourceIds: ['northern-paper'] }),
        team({ slug: 'south-school', nicknames: ['Wildcats'], broadSourceIds: ['southern-paper'] }),
      ],
      [],
    );

    expect(hazards.every((hazard) => hazard.kind === 'contested')).toBe(true);
    expect(hazards[0].detail).toContain('different regions');
  });

  it('says a contested word is safe by circumstance when nothing can reach it', () => {
    const hazards = nicknameHazards(
      [
        team({ slug: 'north-school', nicknames: ['Wildcats'] }),
        team({ slug: 'south-school', nicknames: ['Wildcats'], broadSourceIds: ['southern-paper'] }),
      ],
      [],
    );

    expect(hazards.find((hazard) => hazard.slug === 'north-school')?.detail).toContain('no broad source');
  });

  it('ignores case, because the matcher that consumes these does', () => {
    const hazards = nicknameHazards(
      [
        team({ slug: 'north-school', nicknames: ['WILDCATS'], broadSourceIds: ['metro-paper'] }),
        team({ slug: 'south-school', nicknames: ['wildcats'], broadSourceIds: ['metro-paper'] }),
      ],
      [],
    );

    expect(hazards.map((hazard) => hazard.kind)).toEqual(['shared-source', 'shared-source']);
  });

  it('leaves a word only one team claims alone', () => {
    expect(
      nicknameHazards([team({ slug: 'north-school', nicknames: ['Cornhuskers'] })], []),
    ).toEqual([]);
  });
});

describe('a professional name is reserved whatever the sources are', () => {
  const RESERVED: ReservedName[] = [
    { name: 'Lions', reason: 'Detroit', ownedBy: 'detroit-lions' },
    { name: 'Bears', reason: 'Chicago', ownedBy: null },
  ];

  it('fails a college team claiming one, even with no source to run on', () => {
    const hazards = nicknameHazards([team({ slug: 'penn-state', nicknames: ['Lions'] })], RESERVED);
    expect(hazards).toHaveLength(1);
    expect(hazards[0].kind).toBe('reserved');
    expect(hazards[0].detail).toContain('Detroit');
  });

  // The one case that isn't a collision — otherwise reviewing the NFL
  // would fail every team in it against its own name.
  it('lets the team the name belongs to claim it', () => {
    expect(nicknameHazards([team({ slug: 'detroit-lions', nicknames: ['Lions'] })], RESERVED)).toEqual([]);
  });

  it('reserves a curated word that belongs to nobody in the catalog', () => {
    const hazards = nicknameHazards([team({ slug: 'baylor', nicknames: ['Bears'] })], RESERVED);
    expect(hazards.map((hazard) => hazard.kind)).toEqual(['reserved']);
  });
});

describe('reservedNames', () => {
  it('takes every name from a professional roster and none from a college one', () => {
    const reserved = reservedNames({
      nfl: {
        displayName: 'NFL',
        pro: true,
        teams: [{ slug: 'lions', shortName: 'Lions', displayName: 'Detroit Lions', mascot: 'Lions' }],
      },
      'big-ten': {
        displayName: 'Big Ten',
        pro: false,
        teams: [{ slug: 'michigan', shortName: 'Michigan', displayName: 'Michigan Wolverines', mascot: 'Wolverines' }],
      },
    });

    expect(reserved.some((entry) => entry.name === 'Wolverines')).toBe(false);

    // "Lions" is on the curated list too, and the two halves merge rather
    // than one shadowing the other: the researched reason survives, and so
    // does the fact that Detroit is allowed to claim it.
    const lions = reserved.filter((entry) => entry.name === 'Lions');
    expect(lions).toHaveLength(1);
    expect(lions[0].ownedBy).toBe('lions');
    expect(lions[0].reason).toContain('PennLive');
  });

  it('keeps the curated list as the floor when no league has been snapshotted', () => {
    expect(reservedNames({}).map((entry) => entry.name)).toContain('Lions');
  });
});

describe('the shipped tables, read as the reviewer reads them', () => {
  it('gives every curated slug an entry, whether or not it claims anything', () => {
    const teams = curatedTeams();
    expect(teams.length).toBeGreaterThan(30);
    expect(teams.map((entry) => entry.slug)).toContain('lsu');
  });

  it('knows which teams a nickname could actually fire for', () => {
    const bySlug = new Map(curatedTeams().map((entry) => [entry.slug, entry]));
    // Nebraska's names run against three papers; Northwestern's run against
    // nothing, which is why it can hold a contested word safely.
    expect(nicknamesAreReachable(bySlug.get('nebraska')!)).toBe(true);
    expect(nicknamesAreReachable(bySlug.get('northwestern')!)).toBe(false);
  });
});
