/**
 * The caching shape every remote data source in this directory shares: a
 * resolved-value cache plus an in-flight promise map keyed the same way, so
 * concurrent callers for one key share a single request instead of firing
 * duplicates.
 *
 * Error policy is deliberately the caller's, not this helper's — some
 * sources swallow failures and cache the empty result (team-leaders.ts,
 * player-stats.ts), others let them propagate uncached so the next call
 * retries (roster.ts). Wrap the loader you pass in if you want the former.
 */
export interface EntityCache<K, V> {
  /**
   * Returns the cached value if one is present and unexpired, otherwise the
   * shared in-flight request, otherwise starts a new one via `load`.
   * `force: true` bypasses both reads and refetches, but still shares and
   * caches its own result.
   */
  get(key: K, load: () => Promise<V>, options?: { force?: boolean }): Promise<V>;
  /**
   * The last resolved value for a key, ignoring TTL — a stale read for
   * fallback paths that would rather serve something old than nothing.
   */
  peek(key: K): V | undefined;
}

interface Entry<V> {
  value: V;
  cachedAt: number;
}

/**
 * `ttlMs` bounds *staleness*; `maxEntries` bounds *size*, and they are
 * independent. An expired entry still holds its payload until something
 * overwrites it — that residency is exactly what `peek` serves from — so a
 * TTL alone never reclaims a byte. Anything keyed by something that grows
 * with use rather than with the catalog (teams visited, players opened,
 * headlines seen) wants a `maxEntries` too.
 */
export function createEntityCache<K, V>(options?: {
  ttlMs?: number;
  maxEntries?: number;
}): EntityCache<K, V> {
  const ttlMs = options?.ttlMs;
  const maxEntries = options?.maxEntries;
  const resolved = new Map<K, Entry<V>>();
  const inFlight = new Map<K, Promise<V>>();

  /**
   * Moves a key to the most-recently-used end. A Map iterates in insertion
   * order, so deleting and re-inserting *is* the LRU bookkeeping — no
   * parallel list of access times to keep in sync with the entries.
   */
  function touch(key: K, entry: Entry<V>) {
    resolved.delete(key);
    resolved.set(key, entry);
  }

  function store(key: K, entry: Entry<V>) {
    touch(key, entry);
    if (maxEntries === undefined) return;
    // A loop rather than a single delete: the bound can be lowered between
    // builds, and a cache already over it should settle rather than stay
    // one entry over forever.
    while (resolved.size > maxEntries) {
      const oldest = resolved.keys().next();
      if (oldest.done) break;
      resolved.delete(oldest.value);
    }
  }

  return {
    get(key, load, callOptions) {
      if (!callOptions?.force) {
        // Entry presence, not truthiness — `null` is a legitimate cached
        // value (team-color.ts caches "this team has no usable color").
        const entry = resolved.get(key);
        if (entry && (ttlMs === undefined || Date.now() - entry.cachedAt < ttlMs)) {
          // A cache hit is a use, so it has to count as one — without this
          // the eviction order is insertion order, and the entry the app
          // reads on every screen is evicted as readily as one nobody has
          // touched since it landed.
          touch(key, entry);
          return Promise.resolve(entry.value);
        }

        const existing = inFlight.get(key);
        if (existing) return existing;
      }

      const promise = load()
        .then((value) => {
          store(key, { value, cachedAt: Date.now() });
          return value;
        })
        .finally(() => {
          // Only clear the slot if it's still ours. A `force` refetch replaces
          // the in-flight entry mid-flight, and an unconditional delete would
          // evict that newer promise when this older one settles — leaving the
          // next caller to start a third, redundant request.
          if (inFlight.get(key) === promise) inFlight.delete(key);
        });

      inFlight.set(key, promise);
      return promise;
    },

    peek(key) {
      // Deliberately does not count as a use. `peek` is the last-resort
      // fallback path (team-news-pool.ts's hard cap), and a cache that kept
      // an entry alive because something desperate read it once would
      // preferentially retain exactly the stalest entries it holds.
      return resolved.get(key)?.value;
    },
  };
}
