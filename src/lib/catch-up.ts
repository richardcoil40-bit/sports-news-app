import { DriveOutcome, GameState, isClockEvent, isScoringOutcome, LiveCompetitor } from '@/lib/game';
import { GameSummary, SummaryPlay } from '@/lib/game-summary';

/**
 * "Since you looked" — the brief, applied to a game.
 *
 * The home screen's idea is that the default path through the news ends:
 * unread above a finish line, read collapsed below it. A game has the same
 * shape. What a reader coming back in the third quarter wants is not every
 * play (ESPN has that), but what changed since they last looked, which one
 * play mattered, and how worried to be. Everything here is derived from
 * ESPN's free summary endpoint; no model call, no second source.
 */

export interface DriveLine {
  driveId: string;
  teamId: string;
  abbreviation: string;
  outcome: DriveOutcome;
  displayResult: string;
  plays: number | null;
  yards: number | null;
  elapsed: string | null;
  scoring: boolean;
  /** The score after the drive's last play, or null for a drive with none. */
  endScore: { home: number; away: number } | null;
  /** The drive the reader left in the middle of. */
  startedBeforeMarker: boolean;
  current: boolean;
}

export interface CatchUp {
  /** Where the reader left off, for the heading — null with no marker. */
  since: { period: number; clock: string } | null;
  /** Home win probability then and now, 0–1. */
  swing: { fromHomePct: number; toHomePct: number } | null;
  /** The single play since the marker that moved win probability most. */
  turningPoint: { play: SummaryPlay; deltaHomePct: number } | null;
  /** Drives with anything in them since the marker, chronological. */
  drives: DriveLine[];
  /** What the reader already saw, collapsed to a count and its drives. */
  earlier: { playCount: number; drives: DriveLine[] };
  blurb: string | null;
  /** False when a marker was given but no play carries it any more. */
  markerFound: boolean;
}

/**
 * A turning point smaller than this isn't one. Five points of win
 * probability is a first down in a tight game and nothing at all in a
 * blowout, which is the right way round: the section should go quiet when
 * nothing that happened mattered.
 */
export const MIN_TURNING_POINT_DELTA = 0.05;

/**
 * How far behind a team has to have been for its lead to be a comeback.
 * Seven was tried first and called Kansas City's answer to a first-quarter
 * touchdown a comeback, which it isn't; two scores is.
 */
export const COMEBACK_DEFICIT = 10;

interface Score {
  home: number;
  away: number;
}

function toLine(
  drive: GameSummary['drives'][number],
  startedBeforeMarker: boolean,
): DriveLine {
  const last = drive.plays[drive.plays.length - 1];
  return {
    driveId: drive.id,
    teamId: drive.teamId,
    abbreviation: drive.abbreviation,
    outcome: drive.outcome,
    displayResult: drive.displayResult,
    plays: drive.offensivePlays,
    yards: drive.yards,
    elapsed: drive.elapsed,
    scoring: isScoringOutcome(drive.outcome),
    endScore: last ? { home: last.homeScore, away: last.awayScore } : null,
    startedBeforeMarker,
    current: drive.current,
  };
}

export function catchUp(summary: GameSummary, lastSeenPlayId: string | null): CatchUp {
  const plays: { play: SummaryPlay; driveIndex: number }[] = [];
  summary.drives.forEach((drive, driveIndex) => {
    for (const play of drive.plays) plays.push({ play, driveIndex });
  });

  const wp = new Map(summary.winProbability.map((p) => [p.playId, p.homeWinPct]));

  let markerIdx = lastSeenPlayId === null ? -1 : plays.findIndex((p) => p.play.id === lastSeenPlayId);
  const markerFound = lastSeenPlayId === null || markerIdx >= 0;
  // A marker ESPN no longer knows (a retracted play, a renumbering) shows
  // the whole game rather than guessing where the reader was.
  if (!markerFound) markerIdx = -1;
  const hasMarker = markerIdx >= 0;

  const marker = hasMarker ? plays[markerIdx] : null;
  const newPlays = plays.slice(markerIdx + 1);

  // --- Swing ------------------------------------------------------------
  let from: number | null = null;
  for (let i = markerIdx; i >= 0 && from === null; i--) from = wp.get(plays[i].play.id) ?? null;
  // No marker, or nothing on record at or before it: the first point, which
  // ESPN files before the opening kickoff — the pregame expectation.
  if (from === null) from = summary.winProbability[0]?.homeWinPct ?? null;
  const to = summary.winProbability[summary.winProbability.length - 1]?.homeWinPct ?? null;
  const swing =
    from !== null && to !== null && newPlays.length > 0 ? { fromHomePct: from, toHomePct: to } : null;

  // --- Turning point ----------------------------------------------------
  let turningPoint: CatchUp['turningPoint'] = null;
  let previous = from;
  for (const { play } of newPlays) {
    const value = wp.get(play.id);
    if (value === undefined) continue;
    if (previous !== null && !isClockEvent(play.type)) {
      const delta = value - previous;
      // Strictly greater, so a tie keeps the earlier play.
      if (!turningPoint || Math.abs(delta) > Math.abs(turningPoint.deltaHomePct)) {
        turningPoint = { play, deltaHomePct: delta };
      }
    }
    previous = value;
  }
  if (turningPoint && Math.abs(turningPoint.deltaHomePct) < MIN_TURNING_POINT_DELTA) turningPoint = null;

  // --- Drives -----------------------------------------------------------
  // The marker's own drive is new only if something happened in it after
  // the marker; otherwise it's earlier, or — if it's still on the field
  // with nothing new — in neither list, since the live line already shows it.
  const markerDrive = marker?.driveIndex ?? -1;
  const markerDriveHasNew = newPlays.some((p) => p.driveIndex === markerDrive);

  const drives: DriveLine[] = [];
  const earlierDrives: DriveLine[] = [];
  summary.drives.forEach((drive, i) => {
    if (i < markerDrive) earlierDrives.push(toLine(drive, false));
    else if (i > markerDrive) drives.push(toLine(drive, false));
    else if (markerDriveHasNew) drives.push(toLine(drive, true));
    else if (!drive.current) earlierDrives.push(toLine(drive, false));
  });

  // --- Scores -----------------------------------------------------------
  const before: Score = marker ? { home: marker.play.homeScore, away: marker.play.awayScore } : { home: 0, away: 0 };
  const lastPlay = plays[plays.length - 1]?.play;
  const now: Score = summary.header
    ? { home: summary.header.home.score, away: summary.header.away.score }
    : lastPlay
      ? { home: lastPlay.homeScore, away: lastPlay.awayScore }
      : before;

  const maxDeficit = { home: Math.max(0, before.away - before.home), away: Math.max(0, before.home - before.away) };
  for (const { play } of newPlays) {
    maxDeficit.home = Math.max(maxDeficit.home, play.awayScore - play.homeScore);
    maxDeficit.away = Math.max(maxDeficit.away, play.homeScore - play.awayScore);
  }

  const overtime = (summary.header?.period ?? lastPlay?.period ?? 0) > 4;

  const blurb = summary.header
    ? blurbFor({
        lines: drives,
        hasMarker,
        before,
        now,
        maxDeficit,
        overtime,
        home: summary.header.home,
        away: summary.header.away,
        state: summary.header.state,
      })
    : null;

  return {
    since: marker ? { period: marker.play.period, clock: marker.play.clock } : null,
    swing,
    turningPoint,
    drives,
    earlier: { playCount: hasMarker ? markerIdx + 1 : 0, drives: earlierDrives },
    blurb,
    markerFound,
  };
}

// ---------------------------------------------------------------------------
// Blurbs
// ---------------------------------------------------------------------------

export interface BlurbContext {
  /** Drives since the marker (or the whole game), chronological. */
  lines: readonly DriveLine[];
  hasMarker: boolean;
  before: Score;
  now: Score;
  /** Each side's largest deficit across the window. */
  maxDeficit: Score;
  overtime: boolean;
  home: LiveCompetitor;
  away: LiveCompetitor;
  state: GameState;
}

interface Rule {
  id: string;
  when: (ctx: BlurbContext) => string | null;
}

type Side = 'home' | 'away';

function sideOf(ctx: BlurbContext, teamId: string): Side | null {
  if (teamId === ctx.home.teamId) return 'home';
  if (teamId === ctx.away.teamId) return 'away';
  return null;
}

function nameOf(ctx: BlurbContext, side: Side): string {
  return side === 'home' ? ctx.home.name : ctx.away.name;
}

function teamName(ctx: BlurbContext, teamId: string, fallback: string): string {
  const side = sideOf(ctx, teamId);
  return side ? nameOf(ctx, side) : fallback;
}

function other(side: Side): Side {
  return side === 'home' ? 'away' : 'home';
}

function leader(score: Score): Side | null {
  if (score.home > score.away) return 'home';
  if (score.away > score.home) return 'away';
  return null;
}

function kind(outcome: DriveOutcome): string {
  if (outcome === 'fg') return 'field goal';
  if (outcome === 'safety') return 'safety';
  return 'touchdown';
}

/** After the final. Past tense, about the result rather than the last drives. */
const POST_RULES: Rule[] = [
  {
    id: 'final-tie',
    when: (ctx) => (leader(ctx.now) === null ? 'It ended in a tie.' : null),
  },
  {
    id: 'final-comeback',
    when: (ctx) => {
      const winner = leader(ctx.now)!;
      const down = ctx.maxDeficit[winner];
      return down >= COMEBACK_DEFICIT ? `${nameOf(ctx, winner)} came back from ${down} down to win.` : null;
    },
  },
  {
    id: 'final-overtime',
    when: (ctx) => (ctx.overtime ? `${nameOf(ctx, leader(ctx.now)!)} won it in overtime.` : null),
  },
  {
    id: 'final-close',
    when: (ctx) => {
      const winner = leader(ctx.now)!;
      const margin = Math.abs(ctx.now.home - ctx.now.away);
      return margin <= 3 ? `${nameOf(ctx, winner)} held on by ${margin}.` : null;
    },
  },
  {
    id: 'final',
    when: (ctx) => `${nameOf(ctx, leader(ctx.now)!)} won by ${Math.abs(ctx.now.home - ctx.now.away)}.`,
  },
];

/**
 * During a game. Ordered: the first rule that has something to say wins,
 * so what's above is what matters more — a defensive touchdown outranks
 * the lead change it probably caused. Copy is short and dry, the register
 * of the brief's own finish line; nothing exclaims.
 */
const LIVE_RULES: Rule[] = [
  {
    id: 'nothing-new',
    when: (ctx) => (ctx.hasMarker && ctx.lines.length === 0 ? 'Nothing has happened since you looked.' : null),
  },
  {
    id: 'defensive-score',
    when: (ctx) => {
      const line = [...ctx.lines].reverse().find((l) => l.outcome === 'turnover-td');
      if (!line) return null;
      const side = sideOf(ctx, line.teamId);
      // ESPN files the drive under the team that lost the ball.
      return side ? `${nameOf(ctx, other(side))} scored on a return.` : null;
    },
  },
  {
    id: 'comeback',
    when: (ctx) => {
      const ahead = leader(ctx.now);
      if (!ahead) return null;
      const down = ctx.maxDeficit[ahead];
      return down >= COMEBACK_DEFICIT ? `${nameOf(ctx, ahead)} has come back from ${down} down.` : null;
    },
  },
  {
    id: 'lead-change',
    when: (ctx) => {
      if (!ctx.hasMarker) return null;
      const ahead = leader(ctx.now);
      return ahead && ahead !== leader(ctx.before) ? `${nameOf(ctx, ahead)} has taken the lead.` : null;
    },
  },
  {
    id: 'tied',
    when: (ctx) =>
      ctx.hasMarker && leader(ctx.now) === null && leader(ctx.before) !== null ? "It's tied." : null,
  },
  {
    id: 'turnovers',
    when: (ctx) => {
      const counts = { home: 0, away: 0 };
      for (const line of ctx.lines) {
        if (line.outcome !== 'turnover') continue;
        const side = sideOf(ctx, line.teamId);
        if (side) counts[side]++;
      }
      const total = counts.home + counts.away;
      if (total === 0) return null;
      if (counts.home > 0 && counts.away > 0) return `${total} turnovers between them.`;
      const side: Side = counts.home > 0 ? 'home' : 'away';
      const n = counts[side];
      if (n === 1) return `${nameOf(ctx, side)} turned it over.`;
      if (n === 2) return `${nameOf(ctx, side)} turned it over twice.`;
      return `${nameOf(ctx, side)} has turned it over ${n} times.`;
    },
  },
  {
    id: 'answered',
    when: (ctx) => {
      const scores = ctx.lines.filter((l) => l.scoring && l.outcome !== 'turnover-td');
      if (scores.length < 2) return null;
      const [a, b] = scores.slice(-2);
      if (a.teamId === b.teamId) return null;
      return `${teamName(ctx, b.teamId, b.abbreviation)} answered ${teamName(ctx, a.teamId, a.abbreviation)}'s ${kind(a.outcome)} with a ${kind(b.outcome)}.`;
    },
  },
  {
    id: 'back-to-back',
    when: (ctx) => {
      for (const side of ['home', 'away'] as Side[]) {
        const own = ctx.lines.filter((l) => sideOf(ctx, l.teamId) === side && !l.current);
        if (own.length >= 2 && own[own.length - 1].scoring && own[own.length - 2].scoring) {
          return `${nameOf(ctx, side)} has scored on back-to-back drives.`;
        }
      }
      return null;
    },
  },
  {
    id: 'long-drive',
    when: (ctx) => {
      const line = [...ctx.lines]
        .reverse()
        .find((l) => l.scoring && l.outcome !== 'turnover-td' && ((l.yards ?? 0) >= 75 || (l.plays ?? 0) >= 10));
      if (!line || line.yards === null || line.plays === null) return null;
      return `${teamName(ctx, line.teamId, line.abbreviation)} went ${line.yards} yards in ${line.plays} plays for a ${kind(line.outcome)}.`;
    },
  },
  {
    id: 'missed-kick',
    when: (ctx) => {
      const line = [...ctx.lines].reverse().find((l) => l.outcome === 'missed-fg');
      if (!line) return null;
      const name = teamName(ctx, line.teamId, line.abbreviation);
      return /blocked/i.test(line.displayResult)
        ? `${name} had a field goal blocked.`
        : `${name} missed a field goal.`;
    },
  },
  {
    id: 'first-points',
    when: (ctx) => {
      for (const side of ['home', 'away'] as Side[]) {
        if (ctx.before[side] === 0 && ctx.now[side] > 0) return `${nameOf(ctx, side)} is on the board.`;
      }
      return null;
    },
  },
  {
    id: 'punt-fest',
    when: (ctx) => {
      let run = 0;
      for (let i = ctx.lines.length - 1; i >= 0; i--) {
        const line = ctx.lines[i];
        if (line.current) continue;
        if (line.outcome !== 'punt') break;
        run++;
      }
      return run >= 3 ? `${run} straight punts. Nobody is moving the ball.` : null;
    },
  },
  {
    id: 'score-moved',
    when: (ctx) => {
      const added = (['home', 'away'] as Side[])
        .map((side) => ({ side, n: ctx.now[side] - ctx.before[side] }))
        .filter((a) => a.n > 0)
        .sort((a, b) => b.n - a.n);
      if (added.length === 0) return null;
      return `${added.map((a) => `${nameOf(ctx, a.side)} added ${a.n}`).join(', ')}.`;
    },
  },
  {
    id: 'stalled',
    when: (ctx) => (ctx.lines.some((l) => !l.current) ? "Punts and stalls. The score hasn't moved." : null),
  },
];

export const BLURB_RULES: { post: readonly Rule[]; live: readonly Rule[] } = {
  post: POST_RULES,
  live: LIVE_RULES,
};

/** The one sentence under the swing. Null before kickoff. */
export function blurbFor(ctx: BlurbContext): string | null {
  if (ctx.state === 'pre') return null;
  const rules = ctx.state === 'post' ? POST_RULES : LIVE_RULES;
  for (const rule of rules) {
    const text = rule.when(ctx);
    if (text) return text;
  }
  return null;
}

/** Which rule fired — for tests, so precedence is asserted by name rather than by copy. */
export function blurbRuleFor(ctx: BlurbContext): string | null {
  if (ctx.state === 'pre') return null;
  const rules = ctx.state === 'post' ? POST_RULES : LIVE_RULES;
  return rules.find((rule) => rule.when(ctx) !== null)?.id ?? null;
}

/**
 * One drive as a scannable line, the reader's team's score first:
 *
 *   KC · Touchdown · 12 plays, 75 yds, 6:35 · 14–10
 *   IND · On the field · 3 plays, 18 yds
 */
export function driveLineText(line: DriveLine, mine: Side): string {
  const parts = [line.abbreviation, line.current ? 'On the field' : line.displayResult || 'Drive'];
  const stats: string[] = [];
  if (line.plays !== null) stats.push(`${line.plays} ${line.plays === 1 ? 'play' : 'plays'}`);
  if (line.yards !== null) stats.push(`${line.yards} yds`);
  if (line.elapsed && !line.current) stats.push(line.elapsed);
  if (stats.length > 0) parts.push(stats.join(', '));
  if (line.scoring && line.endScore) {
    const first = line.endScore[mine];
    const second = line.endScore[other(mine)];
    parts.push(`${first}–${second}`);
  }
  return parts.join(' · ');
}
