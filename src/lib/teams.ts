import { fetchWithTimeout } from '@/lib/http';

/**
 * ESPN's public site API — the same JSON endpoints ESPN's own site and apps
 * call. Not RSS, but not scraped HTML either: structured, unauthenticated
 * data from a reputable source. Used because no RSS feed can be filtered
 * per-team or list team rosters.
 *
 * The standings endpoint (rather than the plain /teams list) is the only
 * one that reliably honors a group filter — the /teams endpoint ignores
 * every division/conference filter and always returns all ~800 college
 * football teams across every division. group=5 is the Big Ten (verified
 * against ESPN's response, which tags the conference "big10" and returns
 * its current 18 members).
 */
const BIG_TEN_STANDINGS_URL =
  'https://site.api.espn.com/apis/v2/sports/football/college-football/standings?group=5';

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
 * Scoping to a single conference (group=5) changes the response shape:
 * querying all of FBS (group=80) nests each conference's standings under
 * a top-level `children` array, but querying one conference returns that
 * conference itself as the root object, with `standings.entries` sitting
 * directly at the top — no `children` wrapper.
 */
interface StandingsRoot {
  standings?: { entries?: { team: RawTeam }[] };
}

let cachedTeams: Team[] | null = null;

export async function fetchBigTenTeams(): Promise<Team[]> {
  if (cachedTeams) return cachedTeams;

  const response = await fetchWithTimeout(BIG_TEN_STANDINGS_URL);
  if (!response.ok) throw new Error(`Team list responded ${response.status}`);
  const json: StandingsRoot = await response.json();

  const seen = new Set<string>();
  const teams: Team[] = [];

  for (const entry of json.standings?.entries ?? []) {
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
  cachedTeams = teams;
  return teams;
}
