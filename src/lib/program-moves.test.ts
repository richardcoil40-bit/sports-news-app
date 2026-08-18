import { describe, expect, it } from 'vitest';

import { detectMove, filterProgramMoves, focusGame, isInSeason } from '@/lib/program-moves';
import { ScheduledGame } from '@/lib/schedule';

const NOW = new Date('2026-08-18T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const inDays = (d: number) => new Date(NOW.getTime() + d * DAY).toISOString();

const game = (date: string, overrides: Partial<ScheduledGame> = {}): ScheduledGame => ({
  id: date,
  date,
  opponentName: 'Ohio State Buckeyes',
  opponentShortName: 'Ohio State',
  opponentLogoUrl: null,
  homeAway: 'home',
  network: 'FOX',
  statusDetail: 'Sat at noon',
  completed: false,
  odds: null,
  ...overrides,
});

describe('detectMove', () => {
  const cases: [string, string, ReturnType<typeof detectMove>][] = [
    ['portal entry', 'Smith enters the transfer portal', 'transfer'],
    ['a hire', 'Michigan hires Brian Hartline as offensive coordinator', 'coaching'],
    ['a firing', 'Michigan fires its defensive coordinator', 'coaching'],
    ['an AD change', 'Michigan State names a new athletic director', 'coaching'],
    ['a commitment', 'Four-star quarterback commits to Michigan', 'commitment'],
    ['a decommitment', 'Three-star tackle decommits from Ohio State', 'commitment'],
    ['ordinary news', 'Michigan opens fall camp on Monday', null],
    ['a game result', 'Michigan beats Ohio State 30-24', null],
  ];

  for (const [label, title, expected] of cases) {
    it(label, () => {
      expect(detectMove({ title, description: '' })).toBe(expected);
    });
  }

  // A portal story usually matches the commitment vocabulary too, and
  // "entered the portal" is the more precise description.
  it('prefers transfer over commitment when both match', () => {
    expect(
      detectMove({ title: 'Committed receiver enters the transfer portal', description: '' }),
    ).toBe('transfer');
  });

  it('degrades rather than throwing', () => {
    const junk = { title: null, description: undefined } as unknown as {
      title: string;
      description: string;
    };
    expect(() => detectMove(junk)).not.toThrow();
    expect(detectMove(junk)).toBeNull();
  });
});

describe('filterProgramMoves', () => {
  it('keeps only movement', () => {
    const kept = filterProgramMoves([
      { title: 'Smith enters the transfer portal', description: '' },
      { title: 'Michigan opens fall camp', description: '' },
      { title: 'Michigan hires a coordinator', description: '' },
    ]);
    expect(kept).toHaveLength(2);
  });
});

describe('isInSeason', () => {
  it('is true with a game coming up soon', () => {
    expect(isInSeason([game(inDays(5))], NOW)).toBe(true);
  });

  it('is true just after a game', () => {
    expect(isInSeason([game(inDays(-2))], NOW)).toBe(true);
  });

  // The case that matters today: preseason. The opener is weeks away and a
  // countdown to it is not what the screen should lead with.
  it('is false when the opener is still far off', () => {
    expect(isInSeason([game(inDays(18))], NOW)).toBe(false);
  });

  it('is false long after the last game', () => {
    expect(isInSeason([game(inDays(-40))], NOW)).toBe(false);
  });

  // A failed fetch should degrade to the offseason presentation rather
  // than to a broken countdown.
  it('is false for an empty or unparseable schedule', () => {
    expect(isInSeason([], NOW)).toBe(false);
    expect(isInSeason([game('not a date')], NOW)).toBe(false);
  });
});

describe('focusGame', () => {
  it('picks the next game', () => {
    const chosen = focusGame([game(inDays(20)), game(inDays(5)), game(inDays(40))], NOW);
    expect(chosen?.date).toBe(inDays(5));
  });

  it('still picks a game that just happened over the next one', () => {
    const chosen = focusGame([game(inDays(-1)), game(inDays(6))], NOW);
    expect(chosen?.date).toBe(inDays(-1));
  });

  it('falls back to the most recent result once the season is over', () => {
    const chosen = focusGame([game(inDays(-60)), game(inDays(-30))], NOW);
    expect(chosen?.date).toBe(inDays(-30));
  });

  it('returns null for an empty schedule', () => {
    expect(focusGame([], NOW)).toBeNull();
  });
});
