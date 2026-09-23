import { describe, expect, it } from 'vitest';

import summaryFixture from '@/lib/__fixtures__/espn-game-summary.json';
import {
  BlurbContext,
  blurbFor,
  blurbRuleFor,
  catchUp,
  DriveLine,
  driveLineText,
  MIN_TURNING_POINT_DELTA,
} from '@/lib/catch-up';
import { DriveOutcome, isClockEvent } from '@/lib/game';
import { GameSummary, parseGameSummary } from '@/lib/game-summary';

/** Real: Colts at Chiefs, 2026-09-20, 33–30 in overtime. KC is home. */
const final = parseGameSummary(summaryFixture, '401872945');
const lastPlayOf = (summary: GameSummary, driveIndex: number) => summary.drives[driveIndex].plays.at(-1)!.id;

/**
 * The same game cut off in the third quarter: through Kansas City's
 * go-ahead touchdown (24–20), with the Colts' next drive on the field.
 */
function liveCut(): GameSummary {
  const raw = structuredClone(summaryFixture) as typeof summaryFixture & {
    drives: { previous: unknown[]; current?: unknown };
  };
  const previous = raw.drives.previous.slice(0, 12);
  raw.drives = { previous, current: raw.drives.previous[12] };
  const competition = raw.header.competitions[0];
  competition.status.type = { state: 'in', completed: false, detail: '6:48 - 3rd Quarter', shortDetail: '6:48 - 3rd' };
  competition.competitors[0].score = '24';
  competition.competitors[1].score = '20';
  return parseGameSummary(raw, '401872945');
}

describe('catchUp with no marker', () => {
  const result = catchUp(final, null);

  it('shows the whole game', () => {
    expect(result.since).toBeNull();
    expect(result.markerFound).toBe(true);
    expect(result.drives).toHaveLength(21);
    expect(result.earlier).toEqual({ playCount: 0, drives: [] });
  });

  it('swings from the pregame expectation to the final', () => {
    expect(result.swing).toEqual({ fromHomePct: 0.7693, toHomePct: 1 });
  });

  it('picks a real play as the turning point, never a clock event', () => {
    expect(result.turningPoint).not.toBeNull();
    expect(isClockEvent(result.turningPoint!.play.type)).toBe(false);
    expect(Math.abs(result.turningPoint!.deltaHomePct)).toBeGreaterThanOrEqual(MIN_TURNING_POINT_DELTA);
    // Found by running it: the 31-yard catch with three seconds left in
    // regulation. END QUARTER 4 swung further and was picked before
    // clock events were excluded.
    expect(result.turningPoint!.play.text).toMatch(/R\.Rice .* for 31 yards/);
  });

  it('summarises the result after the final', () => {
    expect(result.blurb).toBe('Kansas City won it in overtime.');
  });
});

describe('catchUp with a marker', () => {
  it('splits the game at the end of the drive the reader last saw', () => {
    const result = catchUp(final, lastPlayOf(final, 9));
    expect(result.since).toEqual({ period: 2, clock: '0:46' });
    expect(result.earlier.drives.map((d) => d.driveId)).toEqual(final.drives.slice(0, 10).map((d) => d.id));
    expect(result.drives.map((d) => d.driveId)).toEqual(final.drives.slice(10).map((d) => d.id));
    expect(result.drives.some((d) => d.startedBeforeMarker)).toBe(false);
    expect(result.earlier.playCount).toBe(final.drives.slice(0, 10).reduce((n, d) => n + d.plays.length, 0));
  });

  it('keeps a drive the reader left in the middle of, once, flagged', () => {
    const drive = final.drives[11];
    const result = catchUp(final, drive.plays[0].id);
    const spanning = result.drives.filter((d) => d.driveId === drive.id);
    expect(spanning).toHaveLength(1);
    expect(spanning[0].startedBeforeMarker).toBe(true);
    expect(result.earlier.drives.map((d) => d.driveId)).not.toContain(drive.id);
  });

  it('swings from the probability at the marker', () => {
    const result = catchUp(final, lastPlayOf(final, 9));
    expect(result.swing?.fromHomePct).not.toBe(0.7693);
    expect(result.swing?.toHomePct).toBe(1);
  });

  it('has nothing to say when the marker is the last play', () => {
    const live = liveCut();
    const last = live.drives.at(-1)!.plays.at(-1)!.id;
    const result = catchUp(live, last);
    expect(result.drives).toEqual([]);
    expect(result.swing).toBeNull();
    expect(result.turningPoint).toBeNull();
    expect(result.blurb).toBe('Nothing has happened since you looked.');
  });

  it('shows the whole game, and says so, when ESPN no longer knows the marker', () => {
    const result = catchUp(final, 'retracted-play');
    expect(result.markerFound).toBe(false);
    expect(result.since).toBeNull();
    expect(result.drives).toHaveLength(21);
  });

  it('reads the lead change in the real third quarter', () => {
    const live = liveCut();
    const result = catchUp(live, lastPlayOf(live, 9));
    expect(live.drives.at(-1)!.current).toBe(true);
    expect(result.drives.map((d) => `${d.abbreviation} ${d.outcome}${d.current ? ' (on field)' : ''}`)).toEqual([
      'IND end-of-period',
      'KC td',
      'IND other (on field)',
    ]);
    expect(result.blurb).toBe('Kansas City has taken the lead.');
  });
});

describe('catchUp without win probability', () => {
  it('has no swing and no turning point', () => {
    const result = catchUp({ ...final, winProbability: [] }, null);
    expect(result.swing).toBeNull();
    expect(result.turningPoint).toBeNull();
  });

  it('keeps quiet about a turning point that barely moved anything', () => {
    const flat = {
      ...final,
      winProbability: final.drives.flatMap((d) => d.plays).map((p, i) => ({ playId: p.id, homeWinPct: 0.5 + (i % 2) * 0.01 })),
    };
    expect(catchUp(flat, null).turningPoint).toBeNull();
  });
});

describe('catchUp before kickoff', () => {
  it('is empty', () => {
    const result = catchUp({ eventId: 'e', header: null, drives: [], winProbability: [] }, null);
    expect(result).toEqual({
      since: null,
      swing: null,
      turningPoint: null,
      drives: [],
      earlier: { playCount: 0, drives: [] },
      blurb: null,
      markerFound: true,
    });
  });
});

// ---------------------------------------------------------------------------
// The blurb table
// ---------------------------------------------------------------------------

const HOME = { teamId: 'h', abbreviation: 'OSU', name: 'Ohio State', score: 0 };
const AWAY = { teamId: 'a', abbreviation: 'MICH', name: 'Michigan', score: 0 };

function line(side: 'h' | 'a', outcome: DriveOutcome, over: Partial<DriveLine> = {}): DriveLine {
  const scoring = outcome === 'td' || outcome === 'fg' || outcome === 'turnover-td' || outcome === 'safety';
  return {
    driveId: Math.random().toString(36),
    teamId: side,
    abbreviation: side === 'h' ? 'OSU' : 'MICH',
    outcome,
    displayResult: outcome,
    plays: 5,
    yards: 30,
    elapsed: '2:00',
    scoring,
    endScore: null,
    startedBeforeMarker: false,
    current: false,
    ...over,
  };
}

function ctx(over: Partial<BlurbContext> = {}): BlurbContext {
  return {
    lines: [],
    hasMarker: true,
    before: { home: 0, away: 0 },
    now: { home: 0, away: 0 },
    maxDeficit: { home: 0, away: 0 },
    overtime: false,
    home: HOME,
    away: AWAY,
    state: 'in',
    ...over,
  };
}

describe('blurbFor, one case per rule', () => {
  // The copy is spelled out in full so a wording change is a deliberate
  // edit to this table, not a side effect.
  const cases: [string, BlurbContext, string][] = [
    ['nothing-new', ctx(), 'Nothing has happened since you looked.'],
    [
      'defensive-score',
      ctx({ lines: [line('h', 'turnover-td')], now: { home: 0, away: 7 } }),
      'Michigan scored on a return.',
    ],
    [
      'comeback',
      ctx({ lines: [line('h', 'td')], before: { home: 3, away: 17 }, now: { home: 21, away: 17 }, maxDeficit: { home: 14, away: 0 } }),
      'Ohio State has come back from 14 down.',
    ],
    ['lead-change', ctx({ lines: [line('a', 'td')], before: { home: 3, away: 0 }, now: { home: 3, away: 7 } }), 'Michigan has taken the lead.'],
    ['tied', ctx({ lines: [line('a', 'fg')], before: { home: 3, away: 0 }, now: { home: 3, away: 3 } }), "It's tied."],
    ['turnovers', ctx({ lines: [line('h', 'turnover'), line('a', 'punt')] }), 'Ohio State turned it over.'],
    [
      'answered',
      ctx({ lines: [line('h', 'fg'), line('a', 'td')], before: { home: 7, away: 0 }, now: { home: 10, away: 7 } }),
      "Michigan answered Ohio State's field goal with a touchdown.",
    ],
    [
      'back-to-back',
      ctx({
        lines: [line('h', 'td'), line('a', 'punt'), line('h', 'fg')],
        before: { home: 7, away: 0 },
        now: { home: 17, away: 0 },
      }),
      'Ohio State has scored on back-to-back drives.',
    ],
    [
      'long-drive',
      ctx({ lines: [line('a', 'punt'), line('h', 'td', { yards: 80, plays: 12 })], before: { home: 7, away: 0 }, now: { home: 14, away: 0 } }),
      'Ohio State went 80 yards in 12 plays for a touchdown.',
    ],
    ['missed-kick', ctx({ lines: [line('a', 'missed-fg', { displayResult: 'Missed FG' })] }), 'Michigan missed a field goal.'],
    [
      'first-points',
      ctx({ lines: [line('a', 'fg'), line('h', 'punt')], before: { home: 7, away: 0 }, now: { home: 7, away: 3 } }),
      'Michigan is on the board.',
    ],
    [
      'punt-fest',
      ctx({ lines: [line('h', 'punt'), line('a', 'punt'), line('h', 'punt'), line('a', 'other', { current: true })] }),
      '3 straight punts. Nobody is moving the ball.',
    ],
    [
      'score-moved',
      ctx({ lines: [line('h', 'fg'), line('a', 'punt')], before: { home: 7, away: 3 }, now: { home: 10, away: 3 } }),
      'Ohio State added 3.',
    ],
    ['stalled', ctx({ lines: [line('h', 'punt'), line('a', 'downs')], before: { home: 7, away: 3 }, now: { home: 7, away: 3 } }), "Punts and stalls. The score hasn't moved."],
  ];

  for (const [rule, context, copy] of cases) {
    it(rule, () => {
      expect(blurbRuleFor(context)).toBe(rule);
      expect(blurbFor(context)).toBe(copy);
    });
  }
});

describe('blurbFor precedence and variants', () => {
  it('a defensive score outranks the lead change it caused', () => {
    const c = ctx({ lines: [line('h', 'turnover-td')], before: { home: 3, away: 0 }, now: { home: 3, away: 7 } });
    expect(blurbRuleFor(c)).toBe('defensive-score');
  });

  it('a comeback outranks a plain lead change', () => {
    const c = ctx({ lines: [line('h', 'td')], before: { home: 10, away: 14 }, now: { home: 17, away: 14 }, maxDeficit: { home: 11, away: 0 } });
    expect(blurbRuleFor(c)).toBe('comeback');
  });

  it('gives the standing, not a drive fact, on a first look mid-game', () => {
    const c = ctx({ hasMarker: false, lines: [line('a', 'fg'), line('h', 'turnover')], now: { home: 0, away: 3 } });
    expect(blurbRuleFor(c)).toBe('standing');
    expect(blurbFor(c)).toBe('Michigan leads by 3.');
    expect(blurbFor(ctx({ hasMarker: false, lines: [line('a', 'fg'), line('h', 'fg')], now: { home: 3, away: 3 } }))).toBe(
      "It's tied at 3.",
    );
    expect(blurbFor(ctx({ hasMarker: false, lines: [line('a', 'punt')] }))).toBe('Scoreless so far.');
  });

  it('still names a comeback on a first look', () => {
    const c = ctx({ hasMarker: false, lines: [line('h', 'td')], now: { home: 21, away: 17 }, maxDeficit: { home: 14, away: 0 } });
    expect(blurbRuleFor(c)).toBe('comeback');
  });

  it('counts turnovers on each side', () => {
    expect(blurbFor(ctx({ lines: [line('h', 'turnover'), line('h', 'turnover')] }))).toBe('Ohio State turned it over twice.');
    expect(blurbFor(ctx({ lines: [line('h', 'turnover'), line('h', 'turnover'), line('h', 'turnover')] }))).toBe(
      'Ohio State has turned it over 3 times.',
    );
    expect(blurbFor(ctx({ lines: [line('h', 'turnover'), line('a', 'turnover')] }))).toBe('2 turnovers between them.');
  });

  it('says blocked when the kick was blocked', () => {
    expect(blurbFor(ctx({ lines: [line('a', 'missed-fg', { displayResult: 'Blocked FG' })] }))).toBe(
      'Michigan had a field goal blocked.',
    );
  });

  it('names both sides when both scored', () => {
    const c = ctx({ lines: [line('h', 'td'), line('a', 'td')], before: { home: 21, away: 7 }, now: { home: 28, away: 14 } });
    // `answered` fires first; drop it to see the fallback.
    expect(blurbRuleFor(c)).toBe('answered');
    const fallback = ctx({
      lines: [line('h', 'td'), line('a', 'punt')],
      before: { home: 21, away: 7 },
      now: { home: 28, away: 9 },
    });
    expect(blurbFor(fallback)).toBe('Ohio State added 7, Michigan added 2.');
  });

  it('has nothing to say before kickoff', () => {
    expect(blurbFor(ctx({ state: 'pre' }))).toBeNull();
  });
});

describe('blurbFor after the final', () => {
  const post = (over: Partial<BlurbContext>) => ctx({ state: 'post', hasMarker: false, ...over });

  it.each<[string, Partial<BlurbContext>, string]>([
    ['final-tie', { now: { home: 20, away: 20 } }, 'It ended in a tie.'],
    ['final-comeback', { now: { home: 24, away: 21 }, maxDeficit: { home: 17, away: 0 } }, 'Ohio State came back from 17 down to win.'],
    ['final-overtime', { now: { home: 24, away: 27 }, overtime: true }, 'Michigan won it in overtime.'],
    ['final-close', { now: { home: 24, away: 21 } }, 'Ohio State held on by 3.'],
    ['final', { now: { home: 42, away: 10 } }, 'Ohio State won by 32.'],
  ])('%s', (rule, over, copy) => {
    expect(blurbRuleFor(post(over))).toBe(rule);
    expect(blurbFor(post(over))).toBe(copy);
  });
});

describe('driveLineText', () => {
  it('puts the reader\'s score first on a scoring drive', () => {
    const scoring = line('a', 'td', { displayResult: 'Touchdown', plays: 12, yards: 75, elapsed: '6:35', endScore: { home: 10, away: 14 } });
    expect(driveLineText(scoring, 'home')).toBe('MICH · Touchdown · 12 plays, 75 yds, 6:35 · 10–14');
    expect(driveLineText(scoring, 'away')).toBe('MICH · Touchdown · 12 plays, 75 yds, 6:35 · 14–10');
  });

  it('marks the drive on the field and leaves its clock off', () => {
    expect(driveLineText(line('h', 'other', { current: true, plays: 1, yards: 4 }), 'home')).toBe('OSU · On the field · 1 play, 4 yds');
  });

  it('shows no score on a drive that didn\'t score', () => {
    expect(driveLineText(line('h', 'punt', { displayResult: 'Punt', endScore: { home: 3, away: 0 } }), 'home')).toBe(
      'OSU · Punt · 5 plays, 30 yds, 2:00',
    );
  });
});
