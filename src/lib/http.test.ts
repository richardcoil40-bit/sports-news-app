import { describe, expect, it } from 'vitest';

import { mapWithConcurrency } from '@/lib/http';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The contract worth protecting is that this is a drop-in for
 * `Promise.allSettled(items.map(fn))` — same result shape, same order, same
 * refusal to let one failure take down the fan-out — with the one addition
 * that it never has more than `limit` calls open at once. Every call site
 * joins results back to the input array by index to name what failed, so
 * ordering is load-bearing rather than incidental.
 */
describe('mapWithConcurrency', () => {
  it('never exceeds the limit', async () => {
    let open = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      open += 1;
      peak = Math.max(peak, open);
      await tick(5);
      open -= 1;
    });

    expect(peak).toBe(3);
  });

  it('returns results in input order, not completion order', async () => {
    const items = [30, 5, 20, 1];

    const results = await mapWithConcurrency(items, 4, async (ms) => {
      await tick(ms);
      return ms;
    });

    expect(results).toEqual(items.map((ms) => ({ status: 'fulfilled', value: ms })));
  });

  it('collects a rejection as a settled slot rather than failing the fan-out', async () => {
    const results = await mapWithConcurrency(['ok', 'bad', 'ok'], 2, async (item) => {
      if (item === 'bad') throw new Error('this one is down');
      return item;
    });

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(results[1]).toMatchObject({ reason: expect.objectContaining({ message: 'this one is down' }) });
  });

  it('keeps going after a rejection', async () => {
    const seen: number[] = [];

    await mapWithConcurrency([1, 2, 3, 4], 1, async (n) => {
      seen.push(n);
      if (n === 2) throw new Error('down');
      return n;
    });

    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it('runs nothing and returns nothing for an empty list', async () => {
    let calls = 0;
    const results = await mapWithConcurrency([], 4, async () => {
      calls += 1;
    });

    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });

  // A slow item should block only itself. Workers pull from a shared cursor
  // rather than owning a fixed slice, so the fast items behind a slow one
  // are picked up by whichever worker is free.
  it('does not leave a worker idle behind a slow item', async () => {
    const order: number[] = [];

    await mapWithConcurrency([60, 1, 1, 1], 2, async (ms, index) => {
      await tick(ms);
      order.push(index);
    });

    expect(order).toEqual([1, 2, 3, 0]);
  });

  it('treats a limit wider than the list as no limit', async () => {
    let open = 0;
    let peak = 0;

    await mapWithConcurrency([1, 2, 3], 50, async () => {
      open += 1;
      peak = Math.max(peak, open);
      await tick(5);
      open -= 1;
    });

    expect(peak).toBe(3);
  });

  // Not a case any caller passes, but a limit of 0 silently doing nothing
  // would be a fan-out that quietly returns holes.
  it('still runs everything when handed a nonsense limit', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 0, async (n) => n * 2);

    expect(results).toEqual([2, 4, 6].map((value) => ({ status: 'fulfilled', value })));
  });
});
