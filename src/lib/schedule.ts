import { createEntityCache } from '@/lib/cache';
import { list, num, str } from '@/lib/espn-raw';
import { fetchWithTimeout } from '@/lib/http';
import { espnCacheKey, espnCorePath, espnSitePath, League } from '@/lib/leagues';

export interface Odds {
  provider: string;
  /** e.g. "OSU -50.5" */
  details: string | null;
  overUnder: number | null;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
}

export type GameResult = 'W' | 'L' | 'T';

export interface ScheduledGame {
  id: string;
  date: string; // ISO
  opponentName: string; // "Michigan Wolverines"
  opponentShortName: string; // "Michigan"
  opponentLogoUrl: string | null;
  homeAway: 'home' | 'away' | 'neutral';
  network: string | null;
  /** ESPN's long form: "Sat, September 5th at 12:30 PM EDT", or just "Final". */
  statusDetail: string;
  /** ESPN's short form: "9/5 - 12:30 PM EDT", "Final", "Final/OT", "3:12 - 3rd". */
  statusShort: string;
  state: 'pre' | 'in' | 'post';
  completed: boolean;
  /**
   * Both sides' points, ours first. Present only once the game is final:
   * the team schedule endpoint sends no score while a game is in progress
   * (checked live against NFL and college games, 2026-09-24) — a live score
   * is the scoreboard's job, not this one's.
   */
  score: { own: number; opponent: number } | null;
  /** How it ended, from our side. Only set once the game is over. */
  result: GameResult | null;
  /** Our overall record *after* this game — "2-1" — as ESPN files it on the event. */
  record: string | null;
  odds: Odds | null;
}

interface RawTeamRef {
  id: string;
  displayName: string;
  shortDisplayName: string;
  logos?: { href: string }[];
}

interface RawCompetitor {
  homeAway: 'home' | 'away';
  team: RawTeamRef;
  score?: unknown;
  winner?: unknown;
  record?: unknown;
}

interface RawBroadcast {
  media?: { shortName?: string };
}

interface RawStatus {
  type?: { detail?: string; shortDetail?: unknown; state?: unknown; completed?: boolean };
}

/**
 * A competitor's points. The schedule endpoint files them as an object
 * (`{ value: 56, displayValue: "56" }`) where the scoreboard sends a bare
 * `"56"` or `56` — so read the object's `value` first and fall through to
 * the bare shape. `num()` on an object is null, so junk degrades to absent.
 */
export function competitorScore(raw: unknown): number | null {
  const value = raw && typeof raw === 'object' ? (raw as { value?: unknown }).value : undefined;
  return num(value) ?? num(raw);
}

/**
 * Who won, from our side. ESPN's `winner` flags are the authoritative call
 * (they cover a forfeit, where the score says nothing); the score comparison
 * is the fallback for a final that carries scores but no flag. A tie is
 * only equal scores with neither side flagged — a lone `winner: false`
 * means nothing on its own, since every loser carries one.
 */
export function gameResult(
  own: { winner: unknown; score: number | null },
  opponent: { winner: unknown; score: number | null },
): GameResult | null {
  if (own.winner === true) return 'W';
  if (opponent.winner === true) return 'L';
  if (own.score === null || opponent.score === null) return null;
  if (own.score > opponent.score) return 'W';
  if (own.score < opponent.score) return 'L';
  return 'T';
}

/** The `total` record if ESPN labelled one, else whatever came first. */
function totalRecord(raw: unknown): string | null {
  const entries = list<{ type?: unknown; displayValue?: unknown }>(raw);
  const total = entries.find((r) => str(r?.type) === 'total') ?? entries[0];
  return str(total?.displayValue);
}

interface RawCompetition {
  id: string;
  neutralSite?: boolean;
  competitors?: RawCompetitor[];
  broadcasts?: RawBroadcast[];
  status?: RawStatus;
}

interface RawEvent {
  id: string;
  date: string;
  competitions?: RawCompetition[];
}

/**
 * ESPN's team-scoped schedule. Same public site API as the rest of the app.
 * Odds aren't included here — they're fetched separately per game, since
 * ESPN only publishes them once a sportsbook has posted a line (often not
 * until close to kickoff), so most future games come back with none.
 */
async function fetchTeamScheduleUncached(
  teamId: string,
  league: League,
): Promise<ScheduledGame[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnSitePath(league)}/teams/${teamId}/schedule?seasontype=2`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`Schedule responded ${response.status}`);
  const json = await response.json();
  const events: RawEvent[] = Array.isArray(json?.events) ? json.events : [];

  const games: ScheduledGame[] = [];
  for (const event of events) {
    const competition = event.competitions?.[0];
    if (!competition) continue;

    const self = competition.competitors?.find((c) => c.team?.id === teamId);
    const opponent = competition.competitors?.find((c) => c.team?.id !== teamId);
    // `team` can be absent on a competitor (a TBD opponent on a future
    // bracket game), which used to throw on opponent.team.displayName below.
    if (!opponent?.team) continue;

    const homeAway: ScheduledGame['homeAway'] = competition.neutralSite
      ? 'neutral'
      : (self?.homeAway ?? 'home');

    const statusType = competition.status?.type;
    const completed = statusType?.completed ?? false;
    const rawState = str(statusType?.state);
    const state: ScheduledGame['state'] =
      rawState === 'in' || rawState === 'post' ? rawState : completed ? 'post' : 'pre';

    // Everything below is gated on `completed`, not on `state`. A canceled or
    // postponed game is state "post" but never completed, and ESPN still files
    // 0-0 scores and the team's *current* record on it — read by state, that
    // is a tie that never happened beside a record the team didn't have yet.
    // Seen live on Ohio State 2020 and the Bills' canceled 2022 game.
    const ownScore = competitorScore(self?.score);
    const opponentScore = competitorScore(opponent.score);
    const score =
      completed && ownScore !== null && opponentScore !== null ? { own: ownScore, opponent: opponentScore } : null;

    games.push({
      id: event.id,
      date: event.date,
      opponentName: opponent.team.displayName,
      opponentShortName: opponent.team.shortDisplayName,
      opponentLogoUrl: opponent.team.logos?.[0]?.href ?? null,
      homeAway,
      network: competition.broadcasts?.[0]?.media?.shortName ?? null,
      statusDetail: statusType?.detail ?? '',
      statusShort: str(statusType?.shortDetail) ?? statusType?.detail ?? '',
      state,
      completed,
      score,
      result: completed
        ? gameResult(
            { winner: self?.winner, score: ownScore },
            { winner: opponent.winner, score: opponentScore },
          )
        : null,
      record: completed ? totalRecord(self?.record) : null,
      odds: null,
    });
  }

  return games;
}

interface RawTeamOddsSide {
  moneyLine?: number;
}

interface RawOddsItem {
  provider?: { name?: string };
  details?: string;
  overUnder?: number;
  homeTeamOdds?: RawTeamOddsSide;
  awayTeamOdds?: RawTeamOddsSide;
}

interface RawOddsRoot {
  items?: RawOddsItem[];
}

/**
 * A game's status, and then its final score, change on game day, so this
 * is a TTL rather than a cache-for-the-process-lifetime like roster.ts. Three minutes matches the
 * news pools, which is the cadence the rest of the app already refreshes at.
 *
 * The team screen re-requests its schedule on every visit and fans out one
 * odds request per upcoming game off the result; without a cache that is
 * a network round trip plus the fan-out every time the tab is opened.
 */
const SCHEDULE_TTL_MS = 3 * 60 * 1000;
// Bounded for the same reason as the other visited-team caches: the TTL
// bounds staleness, not size, and the key grows with the teams a user opens.
const scheduleCache = createEntityCache<string, ScheduledGame[]>({ ttlMs: SCHEDULE_TTL_MS, maxEntries: 100 });

/**
 * Deliberately lets a failure escape rather than caching an empty schedule:
 * per the error-policy note in AGENTS.md, a source that should retry on the
 * next call must throw out of the loader. An empty schedule cached for three
 * minutes would look like a team with no games.
 */
export async function fetchTeamSchedule(
  teamId: string,
  league: League,
  options?: { force?: boolean },
): Promise<ScheduledGame[]> {
  return scheduleCache.get(espnCacheKey(league, teamId), () => fetchTeamScheduleUncached(teamId, league), {
    force: options?.force,
  });
}

/**
 * Best-effort free odds via ESPN's public core API (the same data ESPN's
 * own site pulls from DraftKings). Real sportsbook data, but not always
 * present: ESPN only returns a line once a book has posted one for that
 * game, so this can legitimately come back null for games further out.
 */
export async function fetchGameOdds(
  eventId: string,
  league: League,
): Promise<Odds | null> {
  const url = `https://sports.core.api.espn.com/v2/sports/${espnCorePath(league)}/events/${eventId}/competitions/${eventId}/odds`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) return null;
  const json: RawOddsRoot = await response.json();
  const item = Array.isArray(json?.items) ? json.items[0] : undefined;
  if (!item) return null;

  return {
    provider: item.provider?.name ?? 'Sportsbook',
    details: item.details ?? null,
    overUnder: item.overUnder ?? null,
    homeMoneyline: item.homeTeamOdds?.moneyLine ?? null,
    awayMoneyline: item.awayTeamOdds?.moneyLine ?? null,
  };
}
