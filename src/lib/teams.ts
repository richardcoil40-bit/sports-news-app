import { createEntityCache } from '@/lib/cache';
import { fetchWithTimeout } from '@/lib/http';
import { BIG_TEN, League } from '@/lib/leagues';

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
  return `https://site.api.espn.com/apis/v2/sports/${league.espnSport}/${league.espnLeaguePath}/standings?group=${league.espnGroup}`;
}

export interface Team {
  id: string;
  name: string; // "Georgia Bulldogs"
  shortName: string; // "Georgia"
  abbreviation: string; // "UGA"
  logoUrl: string | null;
}

interface RawTeam {
  id: string;
  displayName: string;
  shortDisplayName: string;
  abbreviation: string;
  logos?: { href: string }[];
}

/**
 * Scoping to a single conference changes the response shape: querying all
 * of FBS (group=80) nests each conference's standings under a top-level
 * `children` array, but querying one conference returns that conference
 * itself as the root object, with `standings.entries` sitting directly at
 * the top — no `children` wrapper.
 */
interface StandingsRoot {
  standings?: { entries?: { team: RawTeam }[] };
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

  for (const entry of json?.standings?.entries ?? []) {
    const t = entry.team;
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    teams.push({
      id: t.id,
      name: t.displayName,
      shortName: t.shortDisplayName,
      abbreviation: t.abbreviation,
      logoUrl: t.logos?.[0]?.href ?? null,
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

/** Defaults to the Big Ten — the only league wired up today. */
export async function fetchTeams(
  league: League = BIG_TEN,
  options?: { force?: boolean },
): Promise<Team[]> {
  return teamsCache.get(league.id, () => fetchTeamsUncached(league), { force: options?.force });
}
