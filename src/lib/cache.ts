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

export function createEntityCache<K, V>(options?: { ttlMs?: number }): EntityCache<K, V> {
  const ttlMs = options?.ttlMs;
  const resolved = new Map<K, { value: V; cachedAt: number }>();
  const inFlight = new Map<K, Promise<V>>();

  return {
    get(key, load, callOptions) {
      if (!callOptions?.force) {
        // Entry presence, not truthiness — `null` is a legitimate cached
        // value (team-color.ts caches "this team has no usable color").
        const entry = resolved.get(key);
        if (entry && (ttlMs === undefined || Date.now() - entry.cachedAt < ttlMs)) {
          return Promise.resolve(entry.value);
        }

        const existing = inFlight.get(key);
        if (existing) return existing;
      }

      const promise = load()
        .then((value) => {
          resolved.set(key, { value, cachedAt: Date.now() });
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
      return resolved.get(key)?.value;
    },
  };
}
