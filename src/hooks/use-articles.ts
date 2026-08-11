import { useCallback, useEffect, useState } from 'react';

import { filterArticlesForTeams } from '@/lib/conference-filter';
import { Article, fetchAllFeeds } from '@/lib/feeds';
import { fetchBigTenTeams } from '@/lib/teams';

export function useArticles() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [feedResult, teams] = await Promise.all([
        fetchAllFeeds({ force: isRefresh }),
        fetchBigTenTeams(),
      ]);
      const bigTenArticles = filterArticlesForTeams(
        feedResult.articles,
        teams.map((t) => t.shortName),
      );
      setArticles(bigTenArticles);
      setFailedSources(feedResult.failedSources);
      if (bigTenArticles.length === 0 && feedResult.failedSources.length > 0) {
        setError('Could not load headlines. Check your connection and try again.');
      }
    } catch {
      setError('Could not load headlines. Check your connection and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return { articles, loading, refreshing, error, failedSources, refresh };
}
