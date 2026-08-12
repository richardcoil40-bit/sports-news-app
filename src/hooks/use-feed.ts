import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useFavorites } from '@/hooks/use-favorites';
import { useTeams } from '@/hooks/use-teams';
import { fetchMultiTeamFeed, FeedArticle } from '@/lib/multi-team-feed';

/**
 * The home feed. Resolves followed team IDs against the live team list
 * (the favorites store only persists IDs — names and logos come from
 * ESPN and shouldn't be frozen into storage), then fetches and merges
 * those teams' news.
 */
export function useFeed() {
  const { favoriteIds, hydrated } = useFavorites();
  const { teams, loading: teamsLoading } = useTeams();

  const [articles, setArticles] = useState<FeedArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same out-of-order guard used in use-teams/use-articles: a slow first
  // response must not land after a faster second one and overwrite it.
  const requestId = useRef(0);

  const followedTeams = useMemo(
    () => teams.filter((team) => favoriteIds.includes(team.id)),
    [teams, favoriteIds],
  );

  // Depend on the ID string rather than the array so the effect below
  // doesn't re-run on every render just because filter() produced a new
  // array with identical contents.
  const followedKey = followedTeams.map((t) => t.id).join(',');

  const load = useCallback(
    async (isRefresh: boolean) => {
      const id = ++requestId.current;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const result = await fetchMultiTeamFeed(followedTeams, { force: isRefresh });
        if (id !== requestId.current) return;
        setArticles(result.articles);
        if (result.articles.length === 0 && result.failedSources.length > 0) {
          setError('Could not load your feed. Check your connection and try again.');
        }
      } catch {
        if (id !== requestId.current) return;
        setError('Could not load your feed. Check your connection and try again.');
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [followedTeams],
  );

  useEffect(() => {
    // Wait for both the persisted favorites and the team list before
    // deciding there's nothing to show — otherwise the empty state
    // flashes on every cold launch before hydration finishes.
    if (!hydrated || teamsLoading) return;

    if (followedTeams.length === 0) {
      setArticles([]);
      setLoading(false);
      return;
    }

    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, teamsLoading, followedKey]);

  const refresh = useCallback(() => load(true), [load]);

  return {
    articles,
    loading: loading && (!hydrated || teamsLoading || followedTeams.length > 0),
    refreshing,
    error,
    refresh,
    followedTeams,
    hasFollowedTeams: followedTeams.length > 0,
    ready: hydrated && !teamsLoading,
  };
}
