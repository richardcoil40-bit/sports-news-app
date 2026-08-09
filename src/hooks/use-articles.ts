import { useCallback, useEffect, useState } from 'react';

import { Article, fetchAllFeeds } from '@/lib/feeds';

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
      const result = await fetchAllFeeds();
      setArticles(result.articles);
      setFailedSources(result.failedSources);
      if (result.articles.length === 0 && result.failedSources.length > 0) {
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
