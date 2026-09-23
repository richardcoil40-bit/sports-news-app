import { createEntityCache } from '@/lib/cache';
import { list, num, str } from '@/lib/espn-raw';
import { DriveOutcome, driveOutcome, GameState, LiveCompetitor, parseDriveDescription } from '@/lib/game';
import { fetchWithTimeout } from '@/lib/http';
import { espnCacheKey, espnSitePath, League } from '@/lib/leagues';
import { parseNetwork, parseSides, parseState, RawStatus } from '@/lib/scoreboard';

export interface SummaryPlay {
  id: string;
  text: string;
  /** ESPN's play type: "Rush", "Punt", "Official Timeout", "End Period". */
  type: string;
  clock: string;
  period: number;
  scoringPlay: boolean;
  homeScore: number;
  awayScore: number;
  /** Where the ball sits after the play: "1st & 10 at IND 35". */
  downDistanceText: string | null;
}

export interface SummaryDrive {
  id: string;
  teamId: string;
  abbreviation: string;
  outcome: DriveOutcome;
  /** "Touchdown", "Punt" — ESPN's own wording, kept for display. */
  displayResult: string;
  offensivePlays: number | null;
  yards: number | null;
  elapsed: string | null;
  plays: SummaryPlay[];
  /** The drive still on the field. */
  current: boolean;
}

export interface WinProbPoint {
  playId: string;
  /** 0–1. */
  homeWinPct: number;
}

export interface GameHeader {
  state: GameState;
  /** ISO kickoff, for the pre-game view. */
  startDate: string | null;
  network: string | null;
  statusDetail: string;
  completed: boolean;
  period: number | null;
  clock: string | null;
  home: LiveCompetitor;
  away: LiveCompetitor;
}

export interface GameSummary {
  eventId: string;
  header: GameHeader | null;
  /** Chronological. */
  drives: SummaryDrive[];
  /** In ESPN's order, which is play order, with one pregame point first. */
  winProbability: WinProbPoint[];
}

export function emptySummary(eventId: string): GameSummary {
  return { eventId, header: null, drives: [], winProbability: [] };
}

interface RawPlay {
  id?: unknown;
  text?: unknown;
  type?: { text?: unknown } | null;
  clock?: { displayValue?: unknown } | null;
  period?: { number?: unknown } | null;
  scoringPlay?: unknown;
  homeScore?: unknown;
  awayScore?: unknown;
  end?: { downDistanceText?: unknown } | null;
}

interface RawDrive {
  id?: unknown;
  description?: unknown;
  result?: unknown;
  displayResult?: unknown;
  offensivePlays?: unknown;
  yards?: unknown;
  timeElapsed?: { displayValue?: unknown } | null;
  team?: { id?: unknown; abbreviation?: unknown } | null;
  plays?: unknown;
}

interface RawSummary {
  header?: { competitions?: unknown } | null;
  drives?: { previous?: unknown; current?: RawDrive | null } | null;
  winprobability?: unknown;
}

function parsePlay(raw: RawPlay | null): SummaryPlay | null {
  // A play with no id is dropped rather than kept anonymous: the reader's
  // "last looked here" marker and the win-probability join both key on it.
  const id = str(raw?.id) ?? (typeof raw?.id === 'number' ? String(raw.id) : null);
  if (!id) return null;
  return {
    id,
    text: str(raw?.text) ?? '',
    type: str(raw?.type?.text) ?? '',
    clock: str(raw?.clock?.displayValue) ?? '',
    period: num(raw?.period?.number) ?? 0,
    scoringPlay: raw?.scoringPlay === true,
    homeScore: num(raw?.homeScore) ?? 0,
    awayScore: num(raw?.awayScore) ?? 0,
    downDistanceText: str(raw?.end?.downDistanceText),
  };
}

function parseDrive(raw: RawDrive | null, current: boolean): SummaryDrive | null {
  const id = str(raw?.id);
  const teamId = str(raw?.team?.id);
  if (!id || !teamId) return null;
  // The structured fields first; the "8 plays, 72 yards, 4:12" description
  // only when ESPN leaves them out, which an in-progress drive may.
  const described = parseDriveDescription(raw?.description);
  return {
    id,
    teamId,
    abbreviation: str(raw?.team?.abbreviation) ?? teamId,
    outcome: current ? 'other' : driveOutcome(raw?.result),
    displayResult: current ? '' : (str(raw?.displayResult) ?? str(raw?.result) ?? ''),
    offensivePlays: num(raw?.offensivePlays) ?? described.plays,
    yards: num(raw?.yards) ?? described.yards,
    elapsed: str(raw?.timeElapsed?.displayValue) ?? described.elapsed,
    plays: list<RawPlay | null>(raw?.plays)
      .map(parsePlay)
      .filter((p): p is SummaryPlay => p !== null),
    current,
  };
}

function parseHeader(raw: RawSummary['header']): GameHeader | null {
  const competition = list<{
    competitors?: unknown;
    status?: RawStatus | null;
    date?: unknown;
    broadcasts?: unknown;
  } | null>(raw?.competitions)[0];
  if (!competition) return null;
  const sides = parseSides(competition.competitors);
  if (!sides) return null;
  const status = competition.status;
  return {
    state: parseState(status?.type),
    startDate: str(competition.date),
    network: parseNetwork(competition),
    statusDetail: str(status?.type?.shortDetail) ?? str(status?.type?.detail) ?? '',
    completed: status?.type?.completed === true,
    period: num(status?.period),
    clock: str(status?.displayClock),
    ...sides,
  };
}

/**
 * Pure. Drives are `previous` (chronological — checked on a real game)
 * then `current` if there is one. The in-progress drive may also be the
 * last entry of `previous` depending on timing, so a current drive whose
 * id is already there replaces that entry rather than appearing twice.
 */
export function parseGameSummary(json: unknown, eventId: string): GameSummary {
  const raw = (json && typeof json === 'object' ? json : {}) as RawSummary;

  const drives = list<RawDrive | null>(raw.drives?.previous)
    .map((d) => parseDrive(d, false))
    .filter((d): d is SummaryDrive => d !== null);
  const current = parseDrive(raw.drives?.current ?? null, true);
  if (current) {
    const existing = drives.findIndex((d) => d.id === current.id);
    if (existing >= 0) drives[existing] = current;
    else drives.push(current);
  }

  const winProbability: WinProbPoint[] = [];
  for (const point of list<{ playId?: unknown; homeWinPercentage?: unknown } | null>(raw.winprobability)) {
    const playId = str(point?.playId) ?? (typeof point?.playId === 'number' ? String(point.playId) : null);
    const pct = num(point?.homeWinPercentage);
    if (playId && pct !== null && pct >= 0 && pct <= 1) winProbability.push({ playId, homeWinPct: pct });
  }

  return { eventId, header: parseHeader(raw.header), drives, winProbability };
}

/**
 * Fifteen seconds, under the game screen's twenty-second poll, so every
 * poll is a real fetch while a screen opened twice in quick succession
 * isn't two. Keyed per event with `espnCacheKey` — event ids are unique
 * within a sport, the same property team ids have. Bounded because it
 * grows with games opened; each entry is a whole game's drives, so the cap
 * is small.
 */
const SUMMARY_TTL_MS = 15 * 1000;
const summaryCache = createEntityCache<string, GameSummary>({ ttlMs: SUMMARY_TTL_MS, maxEntries: 20 });

async function fetchGameSummaryUncached(eventId: string, league: League): Promise<GameSummary> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnSitePath(league)}/summary?event=${encodeURIComponent(eventId)}`;
  const response = await fetchWithTimeout(url);
  // Thrown, not cached empty: a fifteen-second blank game screen is worse
  // than the error state, which retries on the next poll.
  if (!response.ok) throw new Error(`Game summary responded ${response.status}`);
  return parseGameSummary(await response.json(), eventId);
}

export async function fetchGameSummary(
  eventId: string,
  league: League,
  options?: { force?: boolean },
): Promise<GameSummary> {
  return summaryCache.get(espnCacheKey(league, eventId), () => fetchGameSummaryUncached(eventId, league), {
    force: options?.force,
  });
}
