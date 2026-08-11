import { filterArticlesForTeams } from '@/lib/conference-filter';
import { communitySourcesForTeam } from '@/lib/community-sources';
import { Article, fetchAllFeeds, fetchFeeds } from '@/lib/feeds';
import { fetchTeamArticles } from '@/lib/team-news';

export interface TeamNewsPool {
  articles: Article[];
  failedSources: string[];
}

/**
 * Everything the app can find that's plausibly about one team: ESPN's
 * team-scoped news, that team's verified community/independent site (if
 * any — see community-sources.ts), and the general ESPN/CBS/Yahoo pool
 * filtered down to mentions of the team by name. Deduped and sorted
 * newest-first. Used as the base for both the News tab and the Recruiting
 * tab (which filters this same pool further by keyword).
 */
export async function fetchTeamNewsPool(teamId: string, teamShortName: string): Promise<TeamNewsPool> {
  const communitySources = communitySourcesForTeam(teamShortName);

  const [teamNewsResult, communityResult, generalResult] = await Promise.allSettled([
    fetchTeamArticles(teamId),
    communitySources.length > 0 ? fetchFeeds(communitySources) : Promise.resolve({ articles: [], failedSources: [] }),
    fetchAllFeeds(),
  ]);

  const failedSources: string[] = [];
  const lists: Article[][] = [];

  if (teamNewsResult.status === 'fulfilled') lists.push(teamNewsResult.value);
  else failedSources.push('ESPN team news');

  if (communityResult.status === 'fulfilled') {
    lists.push(communityResult.value.articles);
    failedSources.push(...communityResult.value.failedSources);
  } else {
    failedSources.push(...communitySources.map((s) => s.name));
  }

  if (generalResult.status === 'fulfilled') {
    lists.push(filterArticlesForTeams(generalResult.value.articles, [teamShortName]));
    failedSources.push(...generalResult.value.failedSources);
  } else {
    failedSources.push('General college football feeds');
  }

  const seen = new Set<string>();
  const articles = lists.flat().filter((a) => {
    if (seen.has(a.link)) return false;
    seen.add(a.link);
    return true;
  });

  articles.sort((a, b) => {
    if (!a.publishedAt) return 1;
    if (!b.publishedAt) return -1;
    return b.publishedAt.localeCompare(a.publishedAt);
  });

  return { articles, failedSources };
}
