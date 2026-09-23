import { createEntityCache } from '@/lib/cache';
import { favoriteKey } from '@/lib/favorite-keys';
import { GameState, LiveCompetitor } from '@/lib/game';
import { fetchWithTimeout } from '@/lib/http';
import { espnSitePath, League } from '@/lib/leagues';
import { list, num, str } from '@/lib/espn-raw';

/**
 * The down-and-distance block ESPN attaches to a game while, and only
 * while, it is in progress.
 */
export interface LiveSituation {
  /** "3rd & 4 at OSU 34" */
  downDistanceText: string | null;
  possessionTeamId: string | null;
  isRedZone: boolean;
  lastPlayText: string | null;
}

export interface LiveGame {
  id: string;
  leagueId: string;
  state: GameState;
  /** ISO kickoff. */
  startDate: string;
  /** ESPN's `status.type.shortDetail`: "8:12 - 3rd", "Halftime", "Final/OT", "9/26 - 3:30 PM EDT". */
  statusDetail: string;
  completed: boolean;
  clock: string | null;
  period: number | null;
  network: string | null;
  neutralSite: boolean;
  home: LiveCompetitor;
  away: LiveCompetitor;
  situation: LiveSituation | null;
}

/** A game on the board that involves a team you follow, and which side that is. */
export interface FollowedGame extends LiveGame {
  followedTeamId: string;
  followedSide: 'home' | 'away';
}

/**
 * One board per league, not per team — the cost rule in AGENTS.md. A
 * college conference is filtered with `groups` (plural), which is not the
 * standings endpoint's `group`; getting that wrong returns the whole
 * division's board rather than an error.
 */
export function scoreboardUrl(league: League): string {
  const base = `https://site.api.espn.com/apis/site/v2/sports/${espnSitePath(league)}/scoreboard`;
  return league.espnGroup !== undefined ? `${base}?groups=${league.espnGroup}` : base;
}

/**
 * The raw shapes, every field optional and typed as what ESPN *usually*
 * sends. Nothing here is trusted: every read goes through `espn-raw.ts`.
 */
export interface RawTeam {
  id?: unknown;
  abbreviation?: unknown;
  location?: unknown;
  shortDisplayName?: unknown;
  displayName?: unknown;
}

export interface RawCompetitor {
  homeAway?: unknown;
  score?: unknown;
  team?: RawTeam | null;
}

export interface RawStatus {
  displayClock?: unknown;
  period?: unknown;
  type?: { state?: unknown; completed?: unknown; detail?: unknown; shortDetail?: unknown } | null;
}

interface RawSituation {
  downDistanceText?: unknown;
  possession?: unknown;
  isRedZone?: unknown;
  lastPlay?: { text?: unknown } | null;
}

interface RawCompetition {
  date?: unknown;
  neutralSite?: unknown;
  competitors?: unknown;
  status?: RawStatus | null;
  broadcasts?: unknown;
  geoBroadcasts?: unknown;
  situation?: RawSituation | null;
}

interface RawEvent {
  id?: unknown;
  date?: unknown;
  status?: RawStatus | null;
  competitions?: unknown;
}

/**
 * A competitor from either the scoreboard or a summary header — the two
 * endpoints agree on this much. `null` when there's no team to name, which
 * drops the whole game rather than drawing half a score line.
 */
export function parseCompetitor(raw: RawCompetitor | null | undefined): LiveCompetitor | null {
  const team = raw?.team;
  const teamId = str(team?.id);
  if (!teamId) return null;
  const abbreviation = str(team?.abbreviation) ?? str(team?.shortDisplayName) ?? teamId;
  return {
    teamId,
    abbreviation,
    name: str(team?.location) ?? str(team?.shortDisplayName) ?? str(team?.displayName) ?? abbreviation,
    score: num(raw?.score) ?? 0,
  };
}

/** Home and away out of a competitors array, or null if either is missing. */
export function parseSides(
  competitors: unknown,
): { home: LiveCompetitor; away: LiveCompetitor } | null {
  const all = list<RawCompetitor | null>(competitors);
  const home = parseCompetitor(all.find((c) => c?.homeAway === 'home'));
  const away = parseCompetitor(all.find((c) => c?.homeAway === 'away'));
  return home && away ? { home, away } : null;
}

export function parseState(type: RawStatus['type']): GameState {
  const state = type?.state;
  if (state === 'pre' || state === 'in' || state === 'post') return state;
  return type?.completed === true ? 'post' : 'pre';
}

export function parseNetwork(competition: { broadcasts?: unknown; geoBroadcasts?: unknown }): string | null {
  const broadcasts = list<{ media?: { shortName?: unknown } | null; names?: unknown } | null>(competition.broadcasts);
  const geo = list<{ media?: { shortName?: unknown } | null } | null>(competition.geoBroadcasts);
  // The scoreboard carries `names: ["FOX"]`; the team schedule endpoint
  // carries `media.shortName`. Both are read so neither shape is a surprise.
  return (
    str(broadcasts[0]?.media?.shortName) ??
    str(list<unknown>(broadcasts[0]?.names)[0]) ??
    str(geo[0]?.media?.shortName) ??
    null
  );
}

function parseSituation(raw: RawSituation | null | undefined): LiveSituation | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    downDistanceText: str(raw.downDistanceText),
    possessionTeamId: str(raw.possession),
    isRedZone: raw.isRedZone === true,
    lastPlayText: str(raw.lastPlay?.text),
  };
}

/**
 * Pure, so it can be tested without a network. Degrades per event: a game
 * missing an id or either side is dropped, and a body that isn't a board at
 * all is an empty one.
 */
export function parseScoreboard(json: unknown, league: League): LiveGame[] {
  const events = list<RawEvent | null>((json as { events?: unknown } | null)?.events);
  const games: LiveGame[] = [];

  for (const event of events) {
    const id = str(event?.id);
    const competition = list<RawCompetition | null>(event?.competitions)[0];
    if (!id || !competition) continue;

    const sides = parseSides(competition.competitors);
    if (!sides) continue;

    const status = event?.status ?? competition.status;
    const state = parseState(status?.type);

    games.push({
      id,
      leagueId: league.id,
      state,
      startDate: str(event?.date) ?? str(competition.date) ?? '',
      statusDetail: str(status?.type?.shortDetail) ?? str(status?.type?.detail) ?? '',
      completed: status?.type?.completed === true,
      clock: str(status?.displayClock),
      period: num(status?.period),
      network: parseNetwork(competition),
      neutralSite: competition.neutralSite === true,
      ...sides,
      // ESPN omits it outside a game; a stale one after the final would put
      // down and distance on a finished game.
      situation: state === 'in' ? parseSituation(competition.situation) : null,
    });
  }

  return games;
}

/**
 * Thirty seconds: the ticker polls at that cadence while a followed game is
 * live, and anything opened in between (the game screen, a return to the
 * tab) reads the same board instead of fetching its own.
 *
 * Keyed by `league.id`, not `espnCacheKey`. That helper keys on the sport's
 * path so conferences share per-*team* entries, which is exactly wrong for a
 * per-conference board: the Big Ten and the SEC would read each other's.
 * `teams.ts` keys its per-league standings the same way for the same reason.
 * Bounded by the catalog, like the team list; the cap is headroom.
 */
const SCOREBOARD_TTL_MS = 30 * 1000;
const scoreboardCache = createEntityCache<string, LiveGame[]>({ ttlMs: SCOREBOARD_TTL_MS, maxEntries: 50 });

async function fetchScoreboardUncached(league: League): Promise<LiveGame[]> {
  const response = await fetchWithTimeout(scoreboardUrl(league));
  // Thrown rather than cached as empty: an empty board for thirty seconds
  // is a ticker that vanishes mid-game. The next poll retries instead.
  if (!response.ok) throw new Error(`${league.displayName} scoreboard responded ${response.status}`);
  return parseScoreboard(await response.json(), league);
}

export async function fetchScoreboard(league: League, options?: { force?: boolean }): Promise<LiveGame[]> {
  return scoreboardCache.get(league.id, () => fetchScoreboardUncached(league), { force: options?.force });
}

/** The last board fetched for a league, however old — the game screen's fallback. */
export function peekScoreboard(league: League): LiveGame[] | undefined {
  return scoreboardCache.peek(league.id);
}

const STATE_ORDER: Record<GameState, number> = { in: 0, pre: 1, post: 2 };

/**
 * The games on these boards that involve a team you follow.
 *
 * Deduped by event id, because a non-conference game between two followed
 * leagues' teams is on both boards. Live games first, then upcoming by
 * kickoff, then finished — so a cap on how many rows the ticker shows only
 * ever drops the least urgent ones.
 */
export function followedGames(
  boards: readonly { league: League; games: readonly LiveGame[] }[],
  followedKeys: readonly string[],
): FollowedGame[] {
  const followed = new Set(followedKeys);
  const seen = new Set<string>();
  const out: FollowedGame[] = [];

  for (const { league, games } of boards) {
    for (const game of games) {
      if (seen.has(game.id)) continue;
      const homeFollowed = followed.has(favoriteKey(league.id, game.home.teamId));
      const awayFollowed = followed.has(favoriteKey(league.id, game.away.teamId));
      if (!homeFollowed && !awayFollowed) continue;
      seen.add(game.id);
      // Home when both are followed: arbitrary, but stable.
      const followedSide = homeFollowed ? 'home' : 'away';
      out.push({
        ...game,
        followedSide,
        followedTeamId: followedSide === 'home' ? game.home.teamId : game.away.teamId,
      });
    }
  }

  return out.sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      (a.state === 'post' ? Date.parse(b.startDate) - Date.parse(a.startDate) : Date.parse(a.startDate) - Date.parse(b.startDate)) ||
      a.id.localeCompare(b.id),
  );
}
