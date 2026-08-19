import { afterEach, describe, expect, it, vi } from 'vitest';

import { KEEP_MIXED_SPORT_ROUNDUPS } from '@/constants/flags';
import { DEFAULT_LEAGUE } from '@/lib/league-catalog';
import { classifyHeadlines, isRelevantVerdict, Verdict } from '@/lib/verdicts';

const ORIGINAL_URL = process.env.EXPO_PUBLIC_VERDICT_URL;
const ORIGINAL_TOKEN = process.env.EXPO_PUBLIC_VERDICT_TOKEN;

function setUrl(url: string | undefined) {
  if (url === undefined) delete process.env.EXPO_PUBLIC_VERDICT_URL;
  else process.env.EXPO_PUBLIC_VERDICT_URL = url;
}

afterEach(() => {
  setUrl(ORIGINAL_URL);
  if (ORIGINAL_TOKEN === undefined) delete process.env.EXPO_PUBLIC_VERDICT_TOKEN;
  else process.env.EXPO_PUBLIC_VERDICT_TOKEN = ORIGINAL_TOKEN;
  vi.unstubAllGlobals();
});

const verdict = (overrides: Partial<Verdict> = {}): Verdict => ({
  sport: 'football',
  teams: [],
  claim: 'reported',
  kind: 'news',
  ...overrides,
});

function respondWith(verdictsById: Record<string, Verdict | null>) {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { items: { id: string; title: string }[] };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: body.items.map((item) => ({ id: item.id, verdict: verdictsById[item.id] ?? null })),
      }),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('classifyHeadlines — unset EXPO_PUBLIC_VERDICT_URL', () => {
  it('never touches the network and resolves every item to null', async () => {
    setUrl(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const results = await classifyHeadlines([{ id: 'a', title: 'Ohio State wins the opener [unset-1]' }]);

    expect(results.get('a')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('classifyHeadlines — service configured', () => {
  it('classifies each item and returns its verdict', async () => {
    setUrl('https://verdicts.test');
    respondWith({
      a: verdict({ sport: 'volleyball', teams: ['Nebraska'] }),
    });

    const results = await classifyHeadlines([{ id: 'a', title: 'Huskers volleyball sweeps [config-1]' }]);

    expect(results.get('a')).toEqual(verdict({ sport: 'volleyball', teams: ['Nebraska'] }));
  });

  it('sends the Authorization header when EXPO_PUBLIC_VERDICT_TOKEN is set', async () => {
    setUrl('https://verdicts.test');
    process.env.EXPO_PUBLIC_VERDICT_TOKEN = 'secret-token';
    const fetchMock = respondWith({ a: verdict() });

    await classifyHeadlines([{ id: 'a', title: 'A headline worth a token check [config-2]' }]);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer secret-token');
  });

  it('splits more than 100 items into separate batched requests', async () => {
    setUrl('https://verdicts.test');
    const items = Array.from({ length: 150 }, (_, i) => ({
      id: `id-${i}`,
      title: `Headline number ${i} [batch-test]`,
    }));
    const byId = Object.fromEntries(items.map((item) => [item.id, verdict()]));
    const fetchMock = respondWith(byId);

    const results = await classifyHeadlines(items);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results.size).toBe(150);
    expect(results.get('id-0')).toEqual(verdict());
    expect(results.get('id-149')).toEqual(verdict());
  });

  it('memoizes by title, so a repeated headline is not re-fetched', async () => {
    setUrl('https://verdicts.test');
    const fetchMock = respondWith({ a: verdict({ sport: 'basketball' }) });

    await classifyHeadlines([{ id: 'a', title: 'A story that repeats [memo-test]' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Same title, different id — the memo is keyed on title text, and the
    // second call should resolve from it without a second fetch.
    const second = await classifyHeadlines([{ id: 'b', title: 'A story that repeats [memo-test]' }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.get('b')).toEqual(verdict({ sport: 'basketball' }));
  });

  it('does not memoize a failed batch — a later call retries', async () => {
    setUrl('https://verdicts.test');
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const first = await classifyHeadlines([{ id: 'a', title: 'A story worth retrying [retry-test]' }]);
    expect(first.get('a')).toBeNull();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ id: 'b', verdict: verdict({ sport: 'soccer' }) }] }),
    });

    const second = await classifyHeadlines([{ id: 'b', title: 'A story worth retrying [retry-test]' }]);
    expect(second.get('b')).toEqual(verdict({ sport: 'soccer' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('resolves an item to null, not a thrown error, when one batch fails and others succeed', async () => {
    setUrl('https://verdicts.test');
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new Error('this batch is down');
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: [{ id: 'ok', verdict: verdict({ sport: 'tennis' }) }] }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    // Two distinct titles force two separate (unmemoized, unbatched-together
    // in this mock's accounting) fetches isn't guaranteed by batch size
    // alone, so drive this through two sequential calls instead — the
    // contract under test is partial failure across concurrent batches,
    // which classifyHeadlines achieves via Promise.allSettled regardless of
    // how many calls produced the batches.
    const items = Array.from({ length: 101 }, (_, i) => ({
      id: i === 100 ? 'ok' : `fail-${i}`,
      title: i === 100 ? 'The one that succeeds [partial-fail]' : `Headline ${i} [partial-fail]`,
    }));

    const results = await classifyHeadlines(items);

    expect(results.get('fail-0')).toBeNull();
    expect(results.get('ok')).toEqual(verdict({ sport: 'tennis' }));
  });

  it('resolves to null when the response is not ok', async () => {
    setUrl('https://verdicts.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );

    const results = await classifyHeadlines([{ id: 'a', title: 'A headline during an outage [500-test]' }]);

    expect(results.get('a')).toBeNull();
  });
});

describe('isRelevantVerdict', () => {
  it('keeps an article with no verdict — local rules already decided', () => {
    expect(isRelevantVerdict(null, DEFAULT_LEAGUE)).toBe(true);
  });

  it('drops anything the verdict says is not news', () => {
    expect(isRelevantVerdict(verdict({ kind: 'promo' }), DEFAULT_LEAGUE)).toBe(false);
    expect(isRelevantVerdict(verdict({ kind: 'institutional' }), DEFAULT_LEAGUE)).toBe(false);
  });

  it('keeps an article whose verdict identifies the league\'s own sport', () => {
    expect(isRelevantVerdict(verdict({ sport: DEFAULT_LEAGUE.espnSport as Verdict['sport'] }), DEFAULT_LEAGUE)).toBe(
      true,
    );
  });

  it('drops an article whose verdict identifies a different single sport', () => {
    expect(isRelevantVerdict(verdict({ sport: 'volleyball' }), DEFAULT_LEAGUE)).toBe(false);
  });

  it('keeps a verdict that could not identify any sport — no basis to override local rules', () => {
    expect(isRelevantVerdict(verdict({ sport: 'none' }), DEFAULT_LEAGUE)).toBe(true);
  });

  it('drops "other" — a real, identifiable sport outside the enumerated list, so never the league\'s own', () => {
    expect(isRelevantVerdict(verdict({ sport: 'other' }), DEFAULT_LEAGUE)).toBe(false);
  });

  it('applies KEEP_MIXED_SPORT_ROUNDUPS to a "multiple" verdict', () => {
    expect(isRelevantVerdict(verdict({ sport: 'multiple' }), DEFAULT_LEAGUE)).toBe(KEEP_MIXED_SPORT_ROUNDUPS);
  });
});
