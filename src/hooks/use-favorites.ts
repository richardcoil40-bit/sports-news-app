import { useEffect, useSyncExternalStore } from 'react';

import {
  getFavoriteIds,
  hydrateFavorites,
  isHydrated,
  subscribeToFavorites,
  toggleFavorite,
} from '@/lib/favorites';

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

  return { favoriteIds, hydrated, toggleFavorite };
}
