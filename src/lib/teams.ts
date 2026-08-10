/**
 * ESPN's public site API — the same JSON endpoints ESPN's own site and apps
 * call. Not RSS, but not scraped HTML either: structured, unauthenticated
 * data from a reputable source. Used because no RSS feed can be filtered
 * per-team or list team rosters.
 *
 * The standings endpoint (rather than the plain /teams list) is the only
 * one that actually honors group=80 (FBS) — the /teams endpoint ignores
 * every division filter and always returns all ~800 college football
 * teams across every division.
 */
const FBS_STANDINGS_URL =
  'https://site.api.espn.com/apis/v2/sports/football/college-football/standings?group=80';

const FETCH_TIMEOUT_MS = 10000;

export interface Team {
  id: string;
  name: string; // "Georgia Bulldogs"
  shortName: string; // "Georgia"
  abbreviation: string; // "UGA"
  logoUrl: string | null;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

interface RawTeam {
  id: string;
  displayName: string;
  shortDisplayName: string;
  abbreviation: string;
  logos?: { href: string }[];
}

interface ConferenceGroup {
  standings?: { entries?: { team: RawTeam }[] };
}

interface StandingsRoot {
  children?: ConferenceGroup[];
}

let cachedTeams: Team[] | null = null;

export async function fetchAllTeams(): Promise<Team[]> {
  if (cachedTeams) return cachedTeams;

  const response = await fetchWithTimeout(FBS_STANDINGS_URL);
  if (!response.ok) throw new Error(`Team list responded ${response.status}`);
  const json: StandingsRoot = await response.json();

  const seen = new Set<string>();
  const teams: Team[] = [];

  for (const conference of json.children ?? []) {
    for (const entry of conference.standings?.entries ?? []) {
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
  }

  teams.sort((a, b) => a.shortName.localeCompare(b.shortName));
  cachedTeams = teams;
  return teams;
}
