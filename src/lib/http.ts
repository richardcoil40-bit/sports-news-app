export const FETCH_TIMEOUT_MS = 10000;

export async function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * How many requests one fan-out may have open at once.
 *
 * Six rather than something smaller because these limits *multiply*: the
 * home feed fans out over followed teams, each team's pool fans out over
 * four source groups, and each group fans out over its feeds. Every level
 * bounded at six is still tens of sockets, not hundreds — which is the
 * point, since the phone runs out of sockets long before any publisher
 * notices. Six is also above the realistic width of most of these lists
 * today, so it costs no latency until a list actually gets long.
 */
export const DEFAULT_CONCURRENCY = 6;

/**
 * `Promise.allSettled(items.map(fn))` with a ceiling on how many run at
 * once. Same result shape, same tolerate-partial-failure posture — a
 * rejected item is a `rejected` slot, never a thrown fan-out — so it drops
 * into the existing call sites without changing how they read results.
 *
 * Results stay in input order regardless of what finishes when, because
 * every caller here joins them back against the input array by index to
 * name the source that failed.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;

  // Workers pull from a shared cursor rather than being handed a fixed
  // slice each: a slow item then only blocks itself, instead of leaving
  // its whole slice queued behind it while other workers sit idle.
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Math.max(1, Math.min(Math.floor(limit), items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));

  return results;
}
