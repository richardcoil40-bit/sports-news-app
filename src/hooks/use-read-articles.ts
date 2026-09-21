import { useEffect, useSyncExternalStore } from 'react';

import {
  getReadLinks,
  hydrateReadArticles,
  isReadHydrated,
  subscribeToReadArticles,
} from '@/lib/read-articles';

/**
 * Binds React to the read-marks store, the same way useFavorites binds to
 * favorites and for the same reason: the store lives outside React, so a
 * story opened from a team screen is already marked when the home tab next
 * renders, with no provider wrapping the tree.
 *
 * `hydrated` is worth returning rather than hiding. Until the marks are off
 * disk every card would render unread, so a screen that gates on this shows
 * a spinner for a frame instead of flashing a read brief as new.
 */
export function useReadArticles() {
  const readLinks = useSyncExternalStore(subscribeToReadArticles, getReadLinks);
  const hydrated = useSyncExternalStore(subscribeToReadArticles, isReadHydrated);

  useEffect(() => {
    hydrateReadArticles();
  }, []);

  return { readLinks, hydrated };
}
