import { communitySourcesForTeam } from '@/lib/community-sources';
import { filterArticlesForTeams } from '@/lib/conference-filter';
import { Article, fetchAllFeeds, fetchFeeds } from '@/lib/feeds';
import { fetchTeamArticles } from '@/lib/team-news';

export interface TeamNewsPool {
  articles: Article[];
  failedSources: string[];
}

/**
 * Everything the app can find that's plausibly about one team: ESPN's
 * team-scoped news, that team's own community and independent sites, its
 * local newsroom's sports section, and the national pool — the last two
 * narrowed to articles that actually name the team, since a metro sports
 * feed also carries pro teams and other sports.
 *
 * Deduped and sorted newest-first. Used as the base for both the News tab
 * and the Recruiting tab, which filters this same pool further by keyword.
 */
export async function fetchTeamNewsPool(teamId: string, teamShortName: string): Promise<TeamNewsPool> {
  const sources = communitySourcesForTeam(teamShortName);
  const teamScoped = sources.filter((s) => s.scope !== 'broad');
  const broadScoped = sources.filter((s) => s.scope === 'broad');

  const empty = { articles: [] as Article[], failedSources: [] as string[] };

  const [espnResult, teamSiteResult, localResult, generalResult] = await Promise.allSettled([
    fetchTeamArticles(teamId),
    teamScoped.length > 0 ? fetchFeeds(teamScoped) : Promise.resolve(empty),
    broadScoped.length > 0 ? fetchFeeds(broadScoped) : Promise.resolve(empty),
    fetchAllFeeds(),
  ]);

  const failedSources: string[] = [];
  const lists: Article[][] = [];

  if (espnResult.status === 'fulfilled') lists.push(espnResult.value);
  else failedSources.push('ESPN team news');

  // Team-specific sites publish nothing but this team — take all of it.
  if (teamSiteResult.status === 'fulfilled') {
    lists.push(teamSiteResult.value.articles);
    failedSources.push(...teamSiteResult.value.failedSources);
  } else {
    failedSources.push(...teamScoped.map((s) => s.name));
  }

  // Local sports sections and the national pool cover far more than this
  // team, so they only contribute articles that name it.
  if (localResult.status === 'fulfilled') {
    lists.push(filterArticlesForTeams(localResult.value.articles, [teamShortName]));
    failedSources.push(...localResult.value.failedSources);
  } else {
    failedSources.push(...broadScoped.map((s) => s.name));
  }

  if (generalResult.status === 'fulfilled') {
    lists.push(filterArticlesForTeams(generalResult.value.articles, [teamShortName]));
    failedSources.push(...generalResult.value.failedSources);
  } else {
    failedSources.push('National college football feeds');
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
