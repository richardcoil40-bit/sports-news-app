import { useSyncExternalStore } from 'react';

import { getCatalogLeagues, subscribeToLeagueCatalog } from '@/lib/league-catalog';
import { League } from '@/lib/leagues';

/**
 * The catalog, re-rendering the screen if a remote one lands.
 *
 * `useSyncExternalStore` for the same reason `use-favorites.ts` uses it: the
 * catalog lives outside React, in a module that the whole data layer reads
 * synchronously, and wrapping the tree in a provider to announce a list that
 * changes at most once per launch would be a lot of machinery for it.
 *
 * The snapshot is the array itself, which is stable by reference until
 * `refreshLeagueCatalog` installs a new one — so a screen that never sees a
 * remote catalog never re-renders, and `useMemo`s keyed on it hold.
 *
 * Only the pickers need this. Everything else reads `getLeagues()` at fetch
 * time, which is already whatever is in force by then.
 */
export function useLeagueCatalog(): League[] {
  return useSyncExternalStore(subscribeToLeagueCatalog, getCatalogLeagues);
}
