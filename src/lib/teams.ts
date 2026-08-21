import { createEntityCache } from '@/lib/cache';
import { fetchWithTimeout } from '@/lib/http';
import { DEFAULT_LEAGUE, getLeagues } from '@/lib/league-catalog';
import { espnSitePath, League } from '@/lib/leagues';

/**
 * ESPN's public site API — the same JSON endpoints ESPN's own site and apps
 * call. Not RSS, but not scraped HTML either: structured, unauthenticated
 * data from a reputable source. Used because no RSS feed can be filtered
 * per-team or list team rosters.
 *
 * The standings endpoint (rather than the plain /teams list) is the only
 * one that reliably honors a group filter — the /teams endpoint ignores
 * every division/conference filter and always returns all ~800 college
 * football teams across every division. Which group maps to which
 * conference is recorded on the League descriptor in leagues.ts.
 */
function standingsUrl(league: League): string {
  const base = `https://site.api.espn.com/apis/v2/sports/${espnSitePath(league)}/standings`;
  // A whole league (the NFL, the NBA) has no conference to filter by, and
  // appending an empty group returns nothing useful. See the response-shape
  // note on StandingsRoot — omitting it also changes what comes back.
  return league.espnGroup === undefined ? base : `${base}?group=${league.espnGroup}`;
}

export interface Team {
  id: string;
  name: string; // "Georgia Bulldogs"
  shortName: string; // "Georgia" — ESPN abbreviates some of these ("Michigan St")
  /**
   * The school or city as ESPN writes it out in full ("Michigan State").
   *
   * Kept separately from shortName because ESPN abbreviates the latter:
   * Michigan State's shortDisplayName is "Michigan St", which never matches
   * a headline saying "Michigan State" — and that silently tagged every
   * Spartans story MICHIGAN. Anything matching team names against prose
   * wants this field, not shortName.
   */
  location: string;
  abbreviation: string; // "UGA"
  logoUrl: string | null;
  /**
   * Which league this team came from. Carried on the team rather than
   * inferred at the call site because ESPN ids are only unique within a
   * sport — anything that stores or compares a team (favorites, caches)
   * needs the league to disambiguate, and asking each screen to remember
   * that is how the two drift apart.
   */
  leagueId: string;
}

interface RawTeam {
  id: string;
  displayName: string;
  shortDisplayName: string;
  location?: string;
  abbreviation: string;
  logos?: { href: string }[];
}

/**
 * Scoping to a single conference changes the response shape: querying one
 * conference returns that conference itself as the root object, with
 * `standings.entries` sitting directly at the top. Querying a whole league
 * instead nests each division's standings under a top-level `children`
 * array and omits the root-level `standings` entirely.
 *
 * Both shapes have to be handled or a league with no `espnGroup` returns an
 * empty team list — which, per the throw-on-non-OK note below, is precisely
 * the "empty app that looks like it loaded fine" failure this module exists
 * to avoid. Verified against ESPN's NBA standings on 2026-08-18: no root
 * `standings`, two children (Eastern/Western), 15 teams each, `team` object
 * identical in shape to the college-football one.
 */
interface StandingsGroup {
  standings?: { entries?: { team: RawTeam }[] };
}

interface StandingsRoot extends StandingsGroup {
  children?: StandingsGroup[];
}

/** Flattens whichever of the two shapes came back. */
function standingsEntries(json: StandingsRoot): { team: RawTeam }[] {
  const rootEntries = json?.standings?.entries;
  if (rootEntries?.length) return rootEntries;
  return (json?.children ?? []).flatMap((child) => child?.standings?.entries ?? []);
}

async function fetchTeamsUncached(league: League): Promise<Team[]> {
  const response = await fetchWithTimeout(standingsUrl(league));

  // Deliberate exception to the "degrade to empty, never throw" rule the rest
  // of src/lib/ follows. Every other source is supplementary — a screen
  // without stat leaders or a team color is still a usable screen. The team
  // list isn't: it's what the tab bar, the filters, and every per-team fetch
  // are keyed on, so an empty list is an empty app that looks like it loaded
  // fine. Throwing surfaces it as a real error the user can retry instead.
  if (!response.ok) throw new Error(`${league.displayName} team list responded ${response.status}`);

  const json: StandingsRoot = await response.json();

  const seen = new Set<string>();
  const teams: Team[] = [];

  for (const entry of standingsEntries(json)) {
    const t = entry.team;
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    teams.push({
      id: t.id,
      name: t.displayName,
      shortName: t.shortDisplayName,
      location: t.location ?? t.shortDisplayName,
      abbreviation: t.abbreviation,
      logoUrl: t.logos?.[0]?.href ?? null,
      leagueId: league.id,
    });
  }

  teams.sort((a, b) => a.shortName.localeCompare(b.shortName));
  return teams;
}

/**
 * Conference membership changes at realignment, not during a session, so this
 * TTL is only here to bound staleness in a long-lived process — not to keep up
 * with anything. Much longer than the 3 minutes the news pools use, where
 * freshness is the whole point.
 */
const CACHE_TTL_MS = 30 * 60 * 1000;
const teamsCache = createEntityCache<string, Team[]>({ ttlMs: CACHE_TTL_MS });

/** One league's teams. Defaults to the catalog's first available league. */
export async function fetchTeams(
  league: League = DEFAULT_LEAGUE,
  options?: { force?: boolean },
): Promise<Team[]> {
  return teamsCache.get(league.id, () => fetchTeamsUncached(league), { force: options?.force });
}

/**
 * Every team the app can serve, across every available league.
 *
 * This is what anything resolving *followed* teams needs, and the reason
 * is the whole point of league-qualified favorites: a favorite is stored
 * as `"sec:333"`, so a screen holding only the Big Ten's team list can
 * never resolve it. Before a second league existed the two were the same
 * list, and the Teams tab and home feed both quietly assumed so — with
 * the SEC added, that assumption drops every SEC team the user follows.
 *
 * `Promise.allSettled`, not `Promise.all`, and deliberately at odds with
 * the throw-on-failure rule `fetchTeamsUncached` follows: one conference's
 * standings endpoint being down should cost the user that conference, not
 * every team they follow. The throw still stands when *nothing* resolves,
 * which is the case that rule exists for — an empty list that looks like a
 * successful load.
 */
export async function fetchAllTeams(options?: { force?: boolean }): Promise<Team[]> {
  const leagues = getLeagues();
  const results = await Promise.allSettled(leagues.map((league) => fetchTeams(league, options)));

  const teams = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  if (teams.length === 0 && leagues.length > 0) {
    throw new Error('No league team list could be loaded');
  }

  // Sorted across leagues rather than concatenated league by league, so a
  // list spanning conferences still reads alphabetically. Callers that
  // want them grouped have the leagueId to group on.
  return teams.sort((a, b) => a.shortName.localeCompare(b.shortName));
}
