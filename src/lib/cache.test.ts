import { describe, expect, it, vi } from 'vitest';

import { createEntityCache } from '@/lib/cache';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('createEntityCache', () => {
  it('shares one underlying request between concurrent callers for the same key', async () => {
    const load = vi.fn(async () => {
      await tick(10);
      return 'value';
    });
    const cache = createEntityCache<string, string>();

    const [a, b, c] = await Promise.all([
      cache.get('k', load),
      cache.get('k', load),
      cache.get('k', load),
    ]);

    expect(load).toHaveBeenCalledTimes(1);
    expect([a, b, c]).toEqual(['value', 'value', 'value']);
  });

  it('does not share between different keys', async () => {
    const load = vi.fn(async () => 'value');
    const cache = createEntityCache<string, string>();

    await Promise.all([cache.get('one', load), cache.get('two', load)]);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('serves a resolved value without refetching', async () => {
    const load = vi.fn(async () => 'value');
    const cache = createEntityCache<string, string>();

    await cache.get('k', load);
    await cache.get('k', load);

    expect(load).toHaveBeenCalledTimes(1);
  });

  // team-color.ts caches "this team has no usable color" as null. A truthiness
  // check would treat that as a miss and refetch it every single time.
  it('treats null as a real cached value rather than a miss', async () => {
    const load = vi.fn(async () => null);
    const cache = createEntityCache<string, string | null>();

    await cache.get('k', load);
    const second = await cache.get('k', load);

    expect(load).toHaveBeenCalledTimes(1);
    expect(second).toBeNull();
  });

  describe('TTL', () => {
    it('serves from cache while fresh', async () => {
      const load = vi.fn(async () => 'value');
      const cache = createEntityCache<string, string>({ ttlMs: 10_000 });

      await cache.get('k', load);
      await cache.get('k', load);

      expect(load).toHaveBeenCalledTimes(1);
    });

    it('refetches once expired', async () => {
      vi.useFakeTimers();
      try {
        const load = vi.fn(async () => 'value');
        const cache = createEntityCache<string, string>({ ttlMs: 1000 });

        await cache.get('k', load);
        vi.setSystemTime(Date.now() + 999);
        await cache.get('k', load);
        expect(load).toHaveBeenCalledTimes(1);

        vi.setSystemTime(Date.now() + 2);
        await cache.get('k', load);
        expect(load).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('caches for the life of the process when no TTL is given', async () => {
      vi.useFakeTimers();
      try {
        const load = vi.fn(async () => 'value');
        const cache = createEntityCache<string, string>();

        await cache.get('k', load);
        vi.setSystemTime(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await cache.get('k', load);

        expect(load).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('force', () => {
    it('refetches even when a fresh value is cached', async () => {
      const load = vi.fn(async () => 'value');
      const cache = createEntityCache<string, string>({ ttlMs: 10_000 });

      await cache.get('k', load);
      await cache.get('k', load, { force: true });

      expect(load).toHaveBeenCalledTimes(2);
    });
  });

  describe('failures', () => {
    it('propagates the rejection and does not cache it', async () => {
      let attempt = 0;
      const load = vi.fn(async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('first attempt fails');
        return 'recovered';
      });
      const cache = createEntityCache<string, string>();

      await expect(cache.get('k', load)).rejects.toThrow('first attempt fails');
      await expect(cache.get('k', load)).resolves.toBe('recovered');
      expect(load).toHaveBeenCalledTimes(2);
    });

    // Regression: the in-flight slot used to be cleared unconditionally, so an
    // older request settling would evict a newer forced one. With the cache
    // empty (because the older attempt failed) the next caller then started a
    // third request instead of joining the one already running.
    it('an older failing request does not evict a newer in-flight one', async () => {
      let attempt = 0;
      const load = vi.fn(() => {
        attempt += 1;
        const mine = attempt;
        return new Promise<string>((resolve, reject) =>
          setTimeout(
            () => (mine === 1 ? reject(new Error('slow failure')) : resolve(`attempt-${mine}`)),
            mine === 1 ? 20 : 120,
          ),
        );
      });
      const cache = createEntityCache<string, string>({ ttlMs: 10_000 });

      const first = cache.get('k', load);
      first.catch(() => {});
      await tick(5);
      const forced = cache.get('k', load, { force: true });
      await tick(40); // first has rejected by now; forced is still running
      const third = cache.get('k', load);

      await Promise.allSettled([first, forced, third]);
      expect(load).toHaveBeenCalledTimes(2);
      await expect(third).resolves.toBe('attempt-2');
    });
  });

  describe('peek', () => {
    it('returns the last resolved value regardless of TTL', async () => {
      vi.useFakeTimers();
      try {
        const cache = createEntityCache<string, string>({ ttlMs: 10 });
        await cache.get('k', async () => 'stale-but-useful');
        vi.setSystemTime(Date.now() + 60_000);

        expect(cache.peek('k')).toBe('stale-but-useful');
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns undefined for a key that never resolved', () => {
      const cache = createEntityCache<string, string>();
      expect(cache.peek('never-fetched')).toBeUndefined();
    });
  });
});
