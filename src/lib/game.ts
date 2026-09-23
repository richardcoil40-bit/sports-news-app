/**
 * What a single game looks like while it is being played, and the pure
 * formatting both the ticker and the game screen paint.
 *
 * The strings are built here rather than in the components so they can be
 * tested — the components only lay them out. Case is left to the style
 * (the ticker is uppercase mono), so nothing here shouts.
 *
 * Football-shaped where it has to be (quarters, drives, down and distance)
 * but named sport-agnostically, per the Scope section of AGENTS.md: a
 * second sport would add its own derivations beside these rather than
 * rename them.
 */

export type GameState = 'pre' | 'in' | 'post';

export interface LiveCompetitor {
  teamId: string;
  /** "OSU", "KC" — the ticker and drive lines use this. */
  abbreviation: string;
  /**
   * "Ohio State", "Kansas City" — ESPN's `location`, which reads as a
   * singular subject in a sentence ("Kansas City has taken the lead"),
   * where the NFL's `shortDisplayName` is the plural nickname ("Chiefs").
   */
  name: string;
  score: number;
}

/**
 * How a drive ended, reduced to the handful of outcomes the catch-up
 * section reasons about. ESPN's own `result` strings are the input — see
 * `driveOutcome` for the table, which was checked against a real game.
 */
export type DriveOutcome =
  | 'td'
  | 'fg'
  | 'missed-fg'
  | 'punt'
  | 'turnover'
  | 'turnover-td'
  | 'downs'
  | 'safety'
  | 'end-of-period'
  | 'other';

const HOUR = 60 * 60 * 1000;

/**
 * How far ahead a game starts showing in the ticker. Long enough that a
 * noon kickoff is visible over breakfast, short enough that next
 * Saturday's game isn't a permanent fixture on the home screen all week.
 */
export const PRE_GAME_WINDOW_MS = 6 * HOUR;

/**
 * How long a finished game lingers. ESPN's scoreboard carries a kickoff
 * time but no end time, so "three hours after the final" is approximated
 * as kickoff plus a four-hour game plus three. A long overtime game
 * lingers a little less; nothing is lost but a ticker row.
 */
export const POST_GAME_WINDOW_MS = 7 * HOUR;

/** Whether a game belongs in the ticker right now. */
export function inTickerWindow(
  game: { state: GameState; startDate: string },
  now: number,
): boolean {
  if (game.state === 'in') return true;
  const start = Date.parse(game.startDate);
  if (Number.isNaN(start)) return false;
  // A `pre` game whose kickoff has already passed still shows: that is
  // ESPN being slow to flip the state, not the game being over.
  if (game.state === 'pre') return start - now <= PRE_GAME_WINDOW_MS;
  return now - start <= POST_GAME_WINDOW_MS;
}

/**
 * For a schedule row, which knows a date and `completed` but not a live
 * state: is this game close enough to now that its game screen is worth
 * opening? Covers the whole of a game day — from six hours before kickoff
 * to eight after it.
 */
export function isRecentOrUpcoming(dateIso: string, now: number): boolean {
  const start = Date.parse(dateIso);
  if (Number.isNaN(start)) return false;
  return start - now <= PRE_GAME_WINDOW_MS && now - start <= 8 * HOUR;
}

/** 1–4 are quarters, 5 is overtime, 6 is double overtime and so on. */
export function periodLabel(period: number | null): string {
  if (period === null || !Number.isFinite(period) || period < 1) return '';
  if (period <= 4) return `${period}Q`;
  const ot = period - 4;
  return ot === 1 ? 'OT' : `${ot}OT`;
}

/**
 * ESPN's drive `result` → our outcome. Seen on a real NFL game
 * (2026-09-20, Colts at Chiefs): `TD`, `FG`, `INT`, `MISSED FG`, `PUNT`,
 * `END OF HALF`. The rest are ESPN's documented vocabulary; the capture
 * script prints every value it meets so this table can be checked again.
 */
export function driveOutcome(result: unknown): DriveOutcome {
  if (typeof result !== 'string') return 'other';
  const r = result.trim().toUpperCase();
  if (r === 'TD' || r === 'TOUCHDOWN') return 'td';
  if (r === 'FG' || r === 'FIELD GOAL') return 'fg';
  if (r === 'MISSED FG' || r === 'BLOCKED FG' || r === 'FG MISSED') return 'missed-fg';
  if (r === 'PUNT' || r === 'BLOCKED PUNT') return 'punt';
  // "INT TD", "FUMBLE TD", "PUNT RETURN TD", "BLOCKED FG TD": anything
  // that ends in a touchdown but isn't the offense's own. ESPN files the
  // drive under the team that lost the ball, so the other side scored.
  if (r.endsWith(' TD')) return 'turnover-td';
  if (r === 'INT' || r === 'FUMBLE' || r === 'FUMBLE LOST' || r === 'INTERCEPTION' || r === 'TO')
    return 'turnover';
  if (r === 'DOWNS' || r === 'TURNOVER ON DOWNS') return 'downs';
  if (r === 'SAFETY') return 'safety';
  if (r.startsWith('END OF')) return 'end-of-period';
  return 'other';
}

/**
 * A clock event rather than a play: timeouts, the two-minute warning, the
 * end of a period. ESPN files these as plays and attaches win probability
 * to them, and the end of regulation in a tied game moves it a long way —
 * which made "END QUARTER 4" the turning point of a real overtime game.
 * They still count as plays for the marker; they just can't be the one
 * that mattered.
 */
export function isClockEvent(type: string): boolean {
  return /^(end\b|timeout|official timeout|two-minute warning|coin toss)/i.test(type.trim());
}

export function isScoringOutcome(outcome: DriveOutcome): boolean {
  return outcome === 'td' || outcome === 'fg' || outcome === 'turnover-td' || outcome === 'safety';
}

/**
 * ESPN's drive description, "8 plays, 72 yards, 4:12". Only the fallback:
 * drives also carry `offensivePlays`, `yards` and `timeElapsed` as fields,
 * and the parser prefers those. Negative yardage is real ("3 plays, -4
 * yards, 1:12").
 */
export function parseDriveDescription(description: unknown): {
  plays: number | null;
  yards: number | null;
  elapsed: string | null;
} {
  if (typeof description !== 'string') return { plays: null, yards: null, elapsed: null };
  const plays = description.match(/(\d+)\s+plays?/i);
  const yards = description.match(/(-?\d+)\s+yards?/i);
  const elapsed = description.match(/(\d{1,2}:\d{2})/);
  return {
    plays: plays ? Number(plays[1]) : null,
    yards: yards ? Number(yards[1]) : null,
    elapsed: elapsed ? elapsed[1] : null,
  };
}

/** The shape `tickerLine` reads — a `FollowedGame`, minus what it ignores. */
export interface TickerGame {
  state: GameState;
  startDate: string;
  statusDetail: string;
  period: number | null;
  network: string | null;
  neutralSite: boolean;
  home: LiveCompetitor;
  away: LiveCompetitor;
  followedSide: 'home' | 'away';
  situation: { downDistanceText: string | null; possessionTeamId: string | null } | null;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "7:30 PM", or "Sat 7:30 PM" when it isn't today, in the reader's own zone. */
export function kickoffLabel(startDate: string, now: number): string {
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return '';
  const time = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameLocalDay(start, new Date(now))) return time;
  return `${start.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
}

/**
 * One ticker row. The followed team leads, with the schedule row's own
 * "vs" / "@", so the row reads from your side of the field:
 *
 *   in:   OSU 21 vs MICH 17 · 8:12 - 3rd · 3rd & 4 at OSU 34 ● MICH
 *   pre:  IOWA @ MICH · Sat 3:30 PM · CBS
 *   post: Final/OT · KC 33 vs IND 30
 *
 * The clock is ESPN's `shortDetail` verbatim rather than rebuilt from
 * period and clock, because ESPN's vocabulary already covers the states a
 * rebuild would get wrong — "Halftime", "End of 1st", "Delayed".
 */
export function tickerLine(game: TickerGame, now: number): string {
  const mine = game.followedSide === 'home' ? game.home : game.away;
  const theirs = game.followedSide === 'home' ? game.away : game.home;
  const joiner = game.followedSide === 'away' && !game.neutralSite ? '@' : 'vs';

  if (game.state === 'pre') {
    const parts = [`${mine.abbreviation} ${joiner} ${theirs.abbreviation}`, kickoffLabel(game.startDate, now)];
    if (game.network) parts.push(game.network);
    return parts.filter(Boolean).join(' · ');
  }

  const score = `${mine.abbreviation} ${mine.score} ${joiner} ${theirs.abbreviation} ${theirs.score}`;

  if (game.state === 'post') {
    const final = game.statusDetail || (game.period !== null && game.period > 4 ? 'Final/OT' : 'Final');
    return `${final} · ${score}`;
  }

  const parts = [score];
  if (game.statusDetail) parts.push(game.statusDetail);
  const situation = game.situation;
  if (situation?.downDistanceText) {
    const possessor =
      situation.possessionTeamId === game.home.teamId
        ? game.home
        : situation.possessionTeamId === game.away.teamId
          ? game.away
          : null;
    parts.push(possessor ? `${situation.downDistanceText} ● ${possessor.abbreviation}` : situation.downDistanceText);
  }
  return parts.join(' · ');
}
