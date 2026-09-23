import { describe, expect, it } from 'vitest';

import summaryFixture from '@/lib/__fixtures__/espn-game-summary.json';
import { parseGameSummary } from '@/lib/game-summary';

/** Real: Colts at Chiefs, 2026-09-20, 33–30 in overtime, trimmed. */
const summary = parseGameSummary(summaryFixture, '401872945');

describe('parseGameSummary on a real game', () => {
  it('reads the header', () => {
    expect(summary.header).toEqual({
      state: 'post',
      startDate: '2026-09-21T00:20Z',
      network: 'NBC',
      statusDetail: 'Final/OT',
      completed: true,
      period: null,
      clock: null,
      home: { teamId: '12', abbreviation: 'KC', name: 'Kansas City', score: 33 },
      away: { teamId: '11', abbreviation: 'IND', name: 'Indianapolis', score: 30 },
    });
  });

  it('keeps every drive, in order', () => {
    expect(summary.drives).toHaveLength(21);
    expect(summary.drives.slice(0, 4).map((d) => `${d.abbreviation} ${d.outcome}`)).toEqual([
      'IND td',
      'KC fg',
      'IND turnover',
      'KC td',
    ]);
    expect(new Set(summary.drives.map((d) => d.outcome))).toEqual(
      new Set(['td', 'fg', 'turnover', 'missed-fg', 'punt', 'end-of-period']),
    );
    expect(summary.drives.every((d) => !d.current)).toBe(true);
  });

  it('prefers the structured drive fields', () => {
    expect(summary.drives[0]).toMatchObject({
      id: '4018729451',
      teamId: '11',
      displayResult: 'Touchdown',
      offensivePlays: 11,
      yards: 65,
      elapsed: '6:35',
    });
  });

  it('maps a play', () => {
    expect(summary.drives[0].plays[0]).toEqual({
      id: '40187294539',
      text: 'H.Butker kicks 65 yards from KC 35 to end zone, Touchback to the IND 35.',
      type: 'Kickoff',
      clock: '15:00',
      period: 1,
      scoringPlay: false,
      homeScore: 0,
      awayScore: 0,
      downDistanceText: '1st & 10 at IND 35',
    });
  });

  it('keeps win probability in order, pregame point first', () => {
    expect(summary.winProbability[0]).toEqual({ playId: '4018729451', homeWinPct: 0.7693 });
    expect(summary.winProbability.at(-1)?.homeWinPct).toBe(1);
  });
});

describe('parseGameSummary on the shapes a live game adds', () => {
  const drive = (id: string, extra: object = {}) => ({
    id,
    team: { id: '12', abbreviation: 'KC' },
    result: 'PUNT',
    displayResult: 'Punt',
    plays: [{ id: `${id}-1` }],
    ...extra,
  });

  it('appends the drive on the field', () => {
    const parsed = parseGameSummary({ drives: { previous: [drive('1')], current: drive('2', { result: undefined }) } }, 'e');
    expect(parsed.drives.map((d) => [d.id, d.current, d.outcome, d.displayResult])).toEqual([
      ['1', false, 'punt', 'Punt'],
      ['2', true, 'other', ''],
    ]);
  });

  it('replaces, rather than repeats, a current drive also listed as previous', () => {
    const parsed = parseGameSummary({ drives: { previous: [drive('1'), drive('2')], current: drive('2') } }, 'e');
    expect(parsed.drives.map((d) => [d.id, d.current])).toEqual([
      ['1', false],
      ['2', true],
    ]);
  });

  it('falls back to the description when the structured fields are missing', () => {
    const parsed = parseGameSummary({ drives: { current: drive('3', { description: '4 plays, 18 yards, 1:40' }) } }, 'e');
    expect(parsed.drives[0]).toMatchObject({ offensivePlays: 4, yards: 18, elapsed: '1:40' });
  });

  it('drops plays with no id, drives with no team, and unusable win-probability points', () => {
    const parsed = parseGameSummary(
      {
        drives: { previous: [drive('1', { plays: [{ text: 'no id' }, { id: 7, text: 'numeric id' }] }), { id: '2' }] },
        winprobability: [{ playId: 7, homeWinPercentage: 0.5 }, { playId: 'x', homeWinPercentage: 1.5 }, { homeWinPercentage: 0.4 }],
      },
      'e',
    );
    expect(parsed.drives).toHaveLength(1);
    expect(parsed.drives[0].plays.map((p) => p.id)).toEqual(['7']);
    expect(parsed.winProbability).toEqual([{ playId: '7', homeWinPct: 0.5 }]);
  });
});
