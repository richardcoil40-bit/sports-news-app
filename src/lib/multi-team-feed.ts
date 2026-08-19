import { Article } from '@/lib/feeds';
import { DEFAULT_LEAGUE, getLeague } from '@/lib/league-catalog';
import { balanceBySource } from '@/lib/source-balance';
import { fetchTeamNewsPool } from '@/lib/team-news-pool';
import { Team } from '@/lib/teams';

/**
 * An article carries which team surfaced it, because in a merged feed
 * across several followed teams "who is this about" is the one piece of
 * context a headline alone doesn't give you.
 */
export interface FeedArticle extends Article {
  teamId: string;
  teamName: string;
  /**
   * Alongside the id because an ESPN id is unique only within a sport, so
   * the pair is what identifies a team once the feed spans two leagues.
   * team-mentions.ts resolves the pair back to a Team.
   */
  leagueId: string;
}

export interface MultiTeamFeed {
  articles: FeedArticle[];
  failedSources: string[];
}

/**
 * The home feed: every followed team's news pool, merged into one
 * newest-first list.
 *
 * Each team's pool is already cached and in-flight-deduped by
 * fetchTeamNewsPool, so this stays cheap on repeat visits and shares
 * work with the team detail screens rather than duplicating their
 * fetches. Failures are per-team — one team's sources going down
 * shouldn't empty the whole feed.
 */
export async function fetchMultiTeamFeed(
  teams: Team[],
  options?: { force?: boolean },
): Promise<MultiTeamFeed> {
  if (teams.length === 0) return { articles: [], failedSources: [] };

  const results = await Promise.allSettled(
    teams.map(async (team) => {
      // Each team carries the league it came from, so a merged feed across
      // leagues resolves each team's own sources rather than assuming one.
      const league = getLeague(team.leagueId) ?? DEFAULT_LEAGUE;
      const pool = await fetchTeamNewsPool(team.id, team.shortName || team.name, league, options);
      return pool.articles.map(
        (article): FeedArticle => ({
          ...article,
          teamId: team.id,
          teamName: team.shortName,
          leagueId: team.leagueId,
        }),
      );
    }),
  );

  const failedSources: string[] = [];
  const articles: FeedArticle[] = [];
  const seen = new Set<string>();

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      failedSources.push(teams[index].shortName);
      return;
    }
    for (const article of result.value) {
      // A single story can legitimately name two followed teams (a game
      // preview, a conference roundup). It should appear once, credited
      // to whichever team surfaced it first, rather than twice in a row.
      if (seen.has(article.link)) continue;
      seen.add(article.link);
      articles.push(article);
    }
  });

  articles.sort((a, b) => {
    if (!a.publishedAt) return 1;
    if (!b.publishedAt) return -1;
    return b.publishedAt.localeCompare(a.publishedAt);
  });

  // Rebalanced after sorting, so the feed reads chronologically but no
  // single outlet can monopolize the top of it. See lib/source-balance.ts.
  return { articles: balanceBySource(articles), failedSources };
}
