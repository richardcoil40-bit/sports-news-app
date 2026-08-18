import { afterEach, describe, expect, it, vi } from 'vitest';

import rssMalformed from '@/lib/__fixtures__/rss-malformed.xml?raw';
import rssValid from '@/lib/__fixtures__/rss-valid.xml?raw';
import { FeedSource, fetchFeeds } from '@/lib/feeds';

/** Serves a different body per URL, so partial-failure cases are testable. */
function respondPerUrl(byUrl: Record<string, { body?: string; ok?: boolean; status?: number }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const entry = byUrl[url];
      if (!entry) throw new Error(`unexpected fetch: ${url}`);
      return {
        ok: entry.ok ?? true,
        status: entry.status ?? 200,
        text: async () => entry.body ?? '',
      };
    }),
  );
}

const source = (id: string, url: string): FeedSource => ({ id, name: id, url, tier: 3 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchFeeds', () => {
  it('parses a well-formed feed', async () => {
    respondPerUrl({ 'https://a.test/rss': { body: rssValid } });

    const { articles, failedSources } = await fetchFeeds([source('a', 'https://a.test/rss')]);

    expect(failedSources).toEqual([]);
    // The third item has no link and is dropped.
    expect(articles).toHaveLength(2);
    expect(articles[0].title).toBe("Ohio State's defense sets the tone in Ann Arbor");
    expect(articles[0].link).toBe('https://www.landgrantholyland.com/2025/11/29/ohio-state-defense');
    expect(articles[0].publishedAt).toBe('2025-11-30T03:30:00.000Z');
  });

  it('decodes entities inside CDATA', async () => {
    respondPerUrl({ 'https://a.test/rss': { body: rssValid } });

    const { articles } = await fetchFeeds([source('a', 'https://a.test/rss')]);

    // CDATA is passed through verbatim by the XML parser, so a pre-encoded
    // &#39; has to be decoded afterwards or it shows up literally in the UI.
    expect(articles[1].title).toBe("Recruiting notebook: three commits in '26 class");
  });

  it('sorts newest first across sources', async () => {
    respondPerUrl({ 'https://a.test/rss': { body: rssValid } });

    const { articles } = await fetchFeeds([source('a', 'https://a.test/rss')]);
    const dates = articles.map((a) => a.publishedAt);

    expect(dates).toEqual([...dates].sort().reverse());
  });

  describe('malformed bodies degrade to empty rather than throwing', () => {
    const badBodies: [string, string][] = [
      ['a truncated document', rssMalformed],
      ['an empty body', ''],
      ['an HTML error page', '<!DOCTYPE html><html><body><h1>502 Bad Gateway</h1></body></html>'],
      ['plain text', 'not xml at all'],
      ['valid XML that is not RSS', '<?xml version="1.0"?><foo><bar>baz</bar></foo>'],
      ['RSS with no items', '<?xml version="1.0"?><rss><channel><title>Empty</title></channel></rss>'],
      ['a JSON body', '{"items":[{"title":"nope"}]}'],
    ];

    for (const [label, body] of badBodies) {
      it(`handles ${label}`, async () => {
        respondPerUrl({ 'https://a.test/rss': { body } });

        const result = await fetchFeeds([source('a', 'https://a.test/rss')]);

        expect(result.articles).toEqual([]);
      });
    }
  });

  // The allSettled contract from AGENTS.md: one dead feed must not take the
  // others down, and it has to be reported rather than silently dropped.
  it('keeps good sources when one fails, and names the failure', async () => {
    respondPerUrl({
      'https://good.test/rss': { body: rssValid },
      'https://dead.test/rss': { ok: false, status: 503 },
    });

    const { articles, failedSources } = await fetchFeeds([
      source('good', 'https://good.test/rss'),
      source('dead', 'https://dead.test/rss'),
    ]);

    expect(articles).toHaveLength(2);
    expect(failedSources).toEqual(['dead']);
  });

  it('reports a source that throws outright', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const { articles, failedSources } = await fetchFeeds([source('a', 'https://a.test/rss')]);

    expect(articles).toEqual([]);
    expect(failedSources).toEqual(['a']);
  });

  it('dedupes the same link appearing in two feeds', async () => {
    const body = rssValid;
    respondPerUrl({
      'https://a.test/rss': { body },
      'https://b.test/rss': { body },
    });

    const { articles } = await fetchFeeds([
      source('a', 'https://a.test/rss'),
      source('b', 'https://b.test/rss'),
    ]);

    expect(articles).toHaveLength(2);
  });

  it('handles an empty source list', async () => {
    vi.stubGlobal('fetch', vi.fn());

    await expect(fetchFeeds([])).resolves.toEqual({ articles: [], failedSources: [] });
  });
});
