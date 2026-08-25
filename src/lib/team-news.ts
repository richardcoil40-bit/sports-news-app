import type { Article } from '@/lib/feeds';
import { fetchWithTimeout } from '@/lib/http';
import { espnSitePath } from '@/lib/leagues';
import type { League } from '@/lib/leagues';

/**
 * ESPN's JSON news API, at both of its scopes: re-ranked toward one team
 * (`?team=`) or league-wide. One module because it is one endpoint with
 * one response shape — only the query differs.
 */

interface RawArticle {
  id: number;
  headline: string;
  description?: string;
  byline?: string;
  published?: string;
  images?: { url: string }[];
  links?: { web?: { href?: string } };
}

function parsePublished(raw: string | undefined): string | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toArticles(rawArticles: RawArticle[]): Article[] {
  return rawArticles
    .filter((a) => a.links?.web?.href)
    .map(
      (a): Article => ({
        id: String(a.id),
        title: a.headline,
        link: a.links!.web!.href!,
        description: a.description ?? '',
        source: 'ESPN',
        author: a.byline ?? null,
        publishedAt: parsePublished(a.published),
        imageUrl: a.images?.[0]?.url ?? null,
        tier: 1,
        // ESPN at either scope is still ESPN — national coverage, not a
        // beat writer who follows one team daily.
        reach: 'national',
        // And 'broad' for the same reason the pool re-filters it by name:
        // even the team-scoped endpoint only re-ranks toward a team, it
        // doesn't restrict to one.
        scope: 'broad',
      }),
    );
}

/**
 * ESPN's team-scoped news — re-ranked toward the given team, but still
 * mixed with some general college football stories rather than being
 * exclusively about that team.
 */
export async function fetchTeamArticles(teamId: string, league: League): Promise<Article[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnSitePath(league)}/news?team=${teamId}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`Team news responded ${response.status}`);
  const json = await response.json();
  return toArticles(Array.isArray(json?.articles) ? json.articles : []);
}

/**
 * How many league-wide stories to ask for. The API's no-`limit` default
 * is only 6; 20 restores parity with what the retired RSS feed served on
 * a good day. The per-team name filter and `balanceBySource` bound what
 * any screen actually shows, so this is pool depth, not screen space.
 */
const LEAGUE_NEWS_LIMIT = 20;

/**
 * ESPN's league-wide news — the whole sport, no team bias.
 *
 * This is how ESPN reaches the national pools at all: both of its RSS
 * paths (`espn.com/espn/rss/{ncf,nfl}/news`) answer 202 with an empty
 * body more often than not (docs/evidence/README.md), so the college
 * entry was removed from the catalog and the NFL one was never added.
 * This endpoint is the same API family the rest of the app already
 * depends on, with none of that flakiness on record.
 *
 * Failure shape: a 202-with-empty-body still reports as a failure —
 * `response.json()` throws on an empty body, the rejection reaches the
 * caller, and 'ESPN' lands in failedSources. A well-formed 200 whose
 * shape has drifted degrades to empty instead, per the contract every
 * ESPN JSON parser in this repo holds (espn-parsers.test.ts).
 */
export async function fetchLeagueArticles(league: League): Promise<Article[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnSitePath(league)}/news?limit=${LEAGUE_NEWS_LIMIT}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`League news responded ${response.status}`);
  const json = await response.json();
  return toArticles(Array.isArray(json?.articles) ? json.articles : []);
}
