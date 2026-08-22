import { createEntityCache } from '@/lib/cache';
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

export interface ScheduledGame {
  id: string;
  date: string; // ISO
  opponentName: string; // "Michigan Wolverines"
  opponentShortName: string; // "Michigan"
  opponentLogoUrl: string | null;
  homeAway: 'home' | 'away' | 'neutral';
  network: string | null;
  statusDetail: string; // "Sat, September 5th at 12:30 PM EDT" or "Final: W 34-10"
  completed: boolean;
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
}

interface RawBroadcast {
  media?: { shortName?: string };
}

interface RawStatus {
  type?: { detail?: string; completed?: boolean };
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

    games.push({
      id: event.id,
      date: event.date,
      opponentName: opponent.team.displayName,
      opponentShortName: opponent.team.shortDisplayName,
      opponentLogoUrl: opponent.team.logos?.[0]?.href ?? null,
      homeAway,
      network: competition.broadcasts?.[0]?.media?.shortName ?? null,
      statusDetail: competition.status?.type?.detail ?? '',
      completed: competition.status?.type?.completed ?? false,
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
 * Scores move while a game is in progress, so this is a TTL rather than a
 * cache-for-the-process-lifetime like roster.ts. Three minutes matches the
 * news pools, which is the cadence the rest of the app already refreshes at.
 *
 * Added because the home screen now reads a schedule per followed team on
 * mount; without a cache that is one network round trip per team every time
 * the tab is opened.
 */
const SCHEDULE_TTL_MS = 3 * 60 * 1000;
// Bounded for the same reason as the other visited-team caches: the TTL
// bounds staleness, not size, and the home screen reads a schedule per
// followed team on mount.
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
