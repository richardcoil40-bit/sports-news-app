import { describe, expect, it } from 'vitest';

import {
  driveOutcome,
  inTickerWindow,
  isClockEvent,
  isRecentOrUpcoming,
  kickoffLabel,
  parseDriveDescription,
  periodLabel,
  TickerGame,
  tickerLine,
} from '@/lib/game';

const HOUR = 60 * 60 * 1000;
const KICKOFF = Date.parse('2026-09-26T19:30:00Z');

describe('periodLabel', () => {
  it.each([
    [1, '1Q'],
    [4, '4Q'],
    [5, 'OT'],
    [6, '2OT'],
    [null, ''],
    [0, ''],
    [Number.NaN, ''],
  ])('%s → %j', (period, label) => {
    expect(periodLabel(period)).toBe(label);
  });
});

describe('inTickerWindow', () => {
  const at = (state: 'pre' | 'in' | 'post', offsetHours: number) =>
    inTickerWindow({ state, startDate: new Date(KICKOFF).toISOString() }, KICKOFF + offsetHours * HOUR);

  it('always shows a game in progress', () => {
    expect(at('in', -100)).toBe(true);
  });

  it('shows an upcoming game from six hours out, and not before', () => {
    expect(at('pre', -6)).toBe(true);
    expect(at('pre', -6.1)).toBe(false);
  });

  it('keeps a pre game whose kickoff has passed — ESPN is late, not the game over', () => {
    expect(at('pre', 0.5)).toBe(true);
  });

  it('keeps a finished game for seven hours after kickoff', () => {
    expect(at('post', 7)).toBe(true);
    expect(at('post', 7.1)).toBe(false);
  });

  it('drops a game with no usable date rather than showing it forever', () => {
    expect(inTickerWindow({ state: 'pre', startDate: '' }, KICKOFF)).toBe(false);
  });
});

describe('isRecentOrUpcoming', () => {
  const iso = new Date(KICKOFF).toISOString();
  it('covers six hours before to eight after kickoff', () => {
    expect(isRecentOrUpcoming(iso, KICKOFF - 6 * HOUR)).toBe(true);
    expect(isRecentOrUpcoming(iso, KICKOFF + 8 * HOUR)).toBe(true);
    expect(isRecentOrUpcoming(iso, KICKOFF - 7 * HOUR)).toBe(false);
    expect(isRecentOrUpcoming(iso, KICKOFF + 9 * HOUR)).toBe(false);
    expect(isRecentOrUpcoming('not a date', KICKOFF)).toBe(false);
  });
});

describe('driveOutcome', () => {
  // The first six are every result ESPN sent for a real overtime game
  // (Colts at Chiefs, 2026-09-20). The rest are its documented vocabulary.
  it.each([
    ['TD', 'td'],
    ['FG', 'fg'],
    ['INT', 'turnover'],
    ['MISSED FG', 'missed-fg'],
    ['PUNT', 'punt'],
    ['END OF HALF', 'end-of-period'],
    ['END OF GAME', 'end-of-period'],
    ['FUMBLE', 'turnover'],
    ['DOWNS', 'downs'],
    ['SAFETY', 'safety'],
    ['BLOCKED FG', 'missed-fg'],
    ['BLOCKED PUNT', 'punt'],
    ['INT TD', 'turnover-td'],
    ['FUMBLE TD', 'turnover-td'],
    ['PUNT RETURN TD', 'turnover-td'],
    [' td ', 'td'],
    ['SOMETHING NEW', 'other'],
    ['', 'other'],
    [undefined, 'other'],
    [3, 'other'],
  ])('%j → %s', (result, outcome) => {
    expect(driveOutcome(result)).toBe(outcome);
  });
});

describe('isClockEvent', () => {
  it.each(['Official Timeout', 'Timeout', 'End Period', 'End of Half', 'End of Regulation', 'End of Game', 'Two-minute warning'])(
    '%s is a clock event',
    (type) => {
      expect(isClockEvent(type)).toBe(true);
    },
  );

  it.each(['Rush', 'Pass Reception', 'Punt', 'Kickoff', 'Field Goal Good', 'Sack', 'Penalty', ''])('%j is a play', (type) => {
    expect(isClockEvent(type)).toBe(false);
  });
});

describe('parseDriveDescription', () => {
  it('reads ESPN\'s description', () => {
    expect(parseDriveDescription('8 plays, 72 yards, 4:12')).toEqual({ plays: 8, yards: 72, elapsed: '4:12' });
  });

  it('handles a single play and negative yardage', () => {
    expect(parseDriveDescription('1 play, -4 yards, 0:12')).toEqual({ plays: 1, yards: -4, elapsed: '0:12' });
  });

  it('degrades to nulls on junk', () => {
    expect(parseDriveDescription(undefined)).toEqual({ plays: null, yards: null, elapsed: null });
    expect(parseDriveDescription('in progress')).toEqual({ plays: null, yards: null, elapsed: null });
  });
});

const game = (over: Partial<TickerGame> = {}): TickerGame => ({
  state: 'in',
  startDate: new Date(KICKOFF).toISOString(),
  statusDetail: '8:12 - 3rd',
  period: 3,
  network: 'CBS',
  neutralSite: false,
  home: { teamId: '130', abbreviation: 'MICH', name: 'Michigan', score: 17 },
  away: { teamId: '194', abbreviation: 'OSU', name: 'Ohio State', score: 21 },
  followedSide: 'away',
  situation: { downDistanceText: '3rd & 4 at OSU 34', possessionTeamId: '130' },
  ...over,
});

describe('tickerLine', () => {
  it('leads with the followed team and marks possession', () => {
    expect(tickerLine(game(), KICKOFF)).toBe('OSU 21 @ MICH 17 · 8:12 - 3rd · 3rd & 4 at OSU 34 ● MICH');
  });

  it('says vs from the home side, and at a neutral site', () => {
    expect(tickerLine(game({ followedSide: 'home', situation: null }), KICKOFF)).toBe('MICH 17 vs OSU 21 · 8:12 - 3rd');
    expect(tickerLine(game({ neutralSite: true, situation: null }), KICKOFF)).toBe('OSU 21 vs MICH 17 · 8:12 - 3rd');
  });

  it('keeps ESPN\'s own status words, so halftime reads as halftime', () => {
    expect(tickerLine(game({ statusDetail: 'Halftime', situation: null }), KICKOFF)).toBe('OSU 21 @ MICH 17 · Halftime');
  });

  it('drops the possession mark when the possessor is neither side', () => {
    const line = tickerLine(game({ situation: { downDistanceText: '1st & 10 at MICH 25', possessionTeamId: '9' } }), KICKOFF);
    expect(line.endsWith('1st & 10 at MICH 25')).toBe(true);
  });

  it('leads a finished game with the final', () => {
    expect(tickerLine(game({ state: 'post', statusDetail: 'Final/OT', period: 5 }), KICKOFF)).toBe('Final/OT · OSU 21 @ MICH 17');
    expect(tickerLine(game({ state: 'post', statusDetail: '', period: 5 }), KICKOFF)).toBe('Final/OT · OSU 21 @ MICH 17');
  });

  it('shows kickoff and network, without a score, before the game', () => {
    const line = tickerLine(game({ state: 'pre', situation: null }), KICKOFF - HOUR);
    expect(line).toMatch(/^OSU @ MICH · .*\d{1,2}:\d{2}.* · CBS$/);
    expect(line).not.toMatch(/21|17/);
  });
});

describe('kickoffLabel', () => {
  it('names the day only when it isn\'t today', () => {
    const today = kickoffLabel(new Date(KICKOFF).toISOString(), KICKOFF - 60_000);
    const later = kickoffLabel(new Date(KICKOFF).toISOString(), KICKOFF - 3 * 24 * HOUR);
    expect(today).toMatch(/^\d{1,2}:\d{2}/);
    expect(later.length).toBeGreaterThan(today.length);
    expect(later.endsWith(today)).toBe(true);
    expect(kickoffLabel('nope', KICKOFF)).toBe('');
  });
});
