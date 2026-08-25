import {
  mergeWithStored,
  parseStoredArticles,
  parseStoreIndex,
  touchIndex,
} from '@/lib/article-retention';
import { favoriteKey } from '@/lib/favorite-keys';
import { getFavoriteIds } from '@/lib/favorites';
import { League } from '@/lib/leagues';
import { readValue, removeValue, writeValue } from '@/lib/storage';
import { fetchTeamNewsPool, poolCacheKey, TeamNewsPool } from '@/lib/team-news-pool';

/**
 * The persisted article store: a rolling on-device copy of each followed
 * team's news pool, so a thin team's feed accumulates across days instead
 * of being capped at whatever its sources serve right now. The retention
 * rules — and the argument for the store existing — live in
 * article-retention.ts; this file is only the disk half.
 *
 * ## Followed teams only
 *
 * The gate below is what keeps the retention claim in
 * docs/data-retention.md honest: the set of teams with a store entry is
 * derivable from the followed-teams list, not a record of which screens
 * were opened. A team screen reached by deep link reads straight through
 * to the pool. (An entry for a since-unfollowed team lingers until LRU
 * eviction or clear-all — noted in the same doc.)
 *
 * ## Why the pool doesn't do this itself
 *
 * team-news-pool.ts stays free of storage imports so the plain-Node test
 * environment and the review scripts can load it — the same split as
 * favorite-keys.ts / favorites.ts. Screens and the home feed call this
 * wrapper; calling fetchTeamNewsPool directly skips persistence, which is
 * the correct behavior for anything that isn't a followed team's feed.
 *
 * Failure posture is inherited from storage.ts: an unreadable store parses
 * to empty and the merge degrades to exactly the un-persisted behavior.
 * One property worth naming: when every source fails (offline launch), the
 * pool resolves empty-with-failures and the merge serves the stored week —
 * old news beats no news.
 */

const DATA_KEY_PREFIX = 'nofrills.teamArticles.';
const INDEX_KEY = 'nofrills.teamArticles.index';

function dataKey(storeKey: string): string {
  return `${DATA_KEY_PREFIX}${storeKey}`;
}

/**
 * fetchTeamNewsPool, with the followed-team store merged in. Same
 * signature and result shape, so call sites swap one import.
 */
export async function fetchTeamNewsPoolWithStore(
  teamId: string,
  teamShortName: string,
  league: League,
  options?: { force?: boolean },
): Promise<TeamNewsPool> {
  const pool = await fetchTeamNewsPool(teamId, teamShortName, league, options);
  if (!getFavoriteIds().includes(favoriteKey(league.id, teamId))) return pool;

  const storeKey = poolCacheKey(league, teamId);
  const [storedRaw, indexRaw] = await Promise.all([
    readValue(dataKey(storeKey)),
    readValue(INDEX_KEY),
  ]);

  const now = Date.now();
  const { articles, nextStored } = mergeWithStored(
    pool.articles,
    parseStoredArticles(storedRaw),
    now,
  );
  const { index, evicted } = touchIndex(
    parseStoreIndex(indexRaw),
    storeKey,
    new Date(now).toISOString(),
  );

  // Fire-and-forget: the screen's articles don't depend on the write
  // landing, and writeValue/removeValue already swallow their own errors.
  void writeValue(dataKey(storeKey), JSON.stringify(nextStored));
  void writeValue(INDEX_KEY, JSON.stringify(index));
  for (const key of evicted) void removeValue(dataKey(key));

  return { ...pool, articles };
}

/**
 * Deletes every stored article list and the index. Returns how many team
 * entries were removed, for the settings row to report. This is the
 * clear-all the storage.ts chokepoint was built to make possible.
 */
export async function clearStoredArticles(): Promise<number> {
  const index = parseStoreIndex(await readValue(INDEX_KEY));
  await Promise.all(index.map((entry) => removeValue(dataKey(entry.key))));
  await removeValue(INDEX_KEY);
  return index.length;
}
