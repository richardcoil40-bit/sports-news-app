import { Article } from '@/lib/feeds';
import { fetchWithTimeout } from '@/lib/http';

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

/**
 * ESPN's team-scoped news — re-ranked toward the given team, but still
 * mixed with some general college football stories rather than being
 * exclusively about that team.
 */
export async function fetchTeamArticles(teamId: string): Promise<Article[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/news?team=${teamId}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`Team news responded ${response.status}`);
  const json = await response.json();
  const rawArticles: RawArticle[] = json?.articles ?? [];

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
        // ESPN's team-scoped endpoint is still ESPN — national coverage
        // pointed at a team, not a beat writer who follows it daily.
        reach: 'national',
      }),
    );
}
