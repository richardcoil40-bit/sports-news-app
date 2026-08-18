import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { favoriteKey } from '@/lib/favorite-keys';
import {
  getFavoriteIds,
  hydrateFavorites,
  isHydrated,
  subscribeToFavorites,
  toggleFavorite,
} from '@/lib/favorites';
import { Team } from '@/lib/teams';

/**
 * Binds React to the favorites store. useSyncExternalStore is the right
 * primitive here rather than useState + an effect: the store lives
 * outside React (so starring on one tab updates another), and this is
 * what keeps every subscribed screen consistent without a provider
 * wrapping the tree.
 */
export function useFavorites() {
  const favoriteIds = useSyncExternalStore(subscribeToFavorites, getFavoriteIds);
  const hydrated = useSyncExternalStore(subscribeToFavorites, isHydrated);

  useEffect(() => {
    hydrateFavorites();
  }, []);

  // Handed out rather than letting screens test
  // `favoriteIds.includes(team.id)` themselves. Stored keys are
  // league-qualified, so a bare id silently never matches — a bug that
  // still type-checks, because both sides are strings.
  //
  // Derived from the rendered snapshot rather than reading the store
  // directly, so it is consistent with what this render actually saw and
  // its identity changes exactly when the favorites do.
  const isFavorite = useCallback(
    (team: Pick<Team, 'id' | 'leagueId'>) =>
      favoriteIds.includes(favoriteKey(team.leagueId, team.id)),
    [favoriteIds],
  );

  return { favoriteIds, hydrated, isFavorite, toggleFavorite };
}
