import { afterEach, describe, expect, it, vi } from 'vitest';

import atomValid from '@/lib/__fixtures__/atom-valid.xml?raw';
import rssMalformed from '@/lib/__fixtures__/rss-malformed.xml?raw';
import rssValid from '@/lib/__fixtures__/rss-valid.xml?raw';
import { FeedSource, fetchFeeds } from '@/lib/feeds';
import { tierLabel } from '@/lib/source-tier';

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

  // The distinction this whole split exists to draw. A source that hands
  // back something unusable has to be *reported*, not silently counted as
  // a success with zero articles — that's what let seventeen Atom feeds
  // look healthy while returning nothing. A source that is genuinely just
  // quiet must NOT be reported, or every slow news day looks like an
  // outage. Same empty article list, opposite meanings.
  describe('unusable bodies degrade to empty AND are reported as failures', () => {
    const unusableBodies: [string, string][] = [
      ['a truncated document', rssMalformed],
      ['an empty body', ''],
      ['an HTML error page', '<!DOCTYPE html><html><body><h1>502 Bad Gateway</h1></body></html>'],
      ['plain text', 'not xml at all'],
      ['valid XML that is neither RSS nor Atom', '<?xml version="1.0"?><foo><bar>baz</bar></foo>'],
      ['a JSON body', '{"items":[{"title":"nope"}]}'],
      ['an RSS root with no channel', '<?xml version="1.0"?><rss version="2.0"></rss>'],
    ];

    for (const [label, body] of unusableBodies) {
      it(`reports ${label}`, async () => {
        respondPerUrl({ 'https://a.test/rss': { body } });

        const result = await fetchFeeds([source('a', 'https://a.test/rss')]);

        expect(result.articles).toEqual([]);
        expect(result.failedSources).toEqual(['a']);
      });
    }
  });

  // The specific case docs/evidence/README.md filed as a standing known
  // failure. ESPN answers 202 with an empty body, and 202 satisfies
  // response.ok — so the old parser sailed past the status check, parsed
  // nothing, and returned zero articles without ever naming ESPN as
  // failed. Status code and body have to be checked independently.
  it('reports a 2xx response with an empty body (the ESPN 202 case)', async () => {
    respondPerUrl({ 'https://a.test/rss': { ok: true, status: 202, body: '' } });

    const { articles, failedSources } = await fetchFeeds([source('espn', 'https://a.test/rss')]);

    expect(articles).toEqual([]);
    expect(failedSources).toEqual(['espn']);
  });

  describe('a well-formed feed with no items is a success, not a failure', () => {
    const emptyButValid: [string, string][] = [
      ['RSS', '<?xml version="1.0"?><rss><channel><title>Empty</title></channel></rss>'],
      [
        'Atom',
        '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Empty</title></feed>',
      ],
    ];

    for (const [label, body] of emptyButValid) {
      it(`does not report an empty ${label} feed`, async () => {
        respondPerUrl({ 'https://a.test/rss': { body } });

        const result = await fetchFeeds([source('a', 'https://a.test/rss')]);

        expect(result.articles).toEqual([]);
        expect(result.failedSources).toEqual([]);
      });
    }
  });

  // Seventeen of the app's thirty-five sources are Atom, not RSS — every
  // SB Nation team blog plus Off Tackle Empire. They parsed to zero
  // articles and reported no failure, so they were invisible in both
  // directions. Verified against the live Off Tackle Empire body on
  // 2026-08-17; this fixture is trimmed from it.
  describe('Atom feeds', () => {
    it('parses an Atom feed into the same Article shape as RSS', async () => {
      respondPerUrl({ 'https://a.test/atom': { body: atomValid } });

      const { articles, failedSources } = await fetchFeeds([source('a', 'https://a.test/atom')]);

      expect(failedSources).toEqual([]);
      // Four entries, one of which has no resolvable href and is dropped.
      expect(articles).toHaveLength(3);

      const first = articles[0];
      expect(first.title).toBe('A Blog, If We Could Keep It');
      expect(first.link).toBe(
        'https://www.offtackleempire.com/latest-news/50084/a-blog-if-we-could-keep-it',
      );
      expect(first.author).toBe('MN Wildcat');
      expect(first.description).toBe(
        'Off Tackle Empire makes no claim to be important; rather, it is a silly place on the internet.',
      );
      // <published>, not <updated>, when both are present.
      expect(first.publishedAt).toBe('2026-08-10T11:00:00.000Z');
      expect(first.imageUrl).toBe(
        'https://platform.offtackleempire.com/wp-content/uploads/notre-dame.jpg',
      );
    });

    it('uses the id-free link element, ignoring rel="replies"', async () => {
      respondPerUrl({ 'https://a.test/atom': { body: atomValid } });

      const { articles } = await fetchFeeds([source('a', 'https://a.test/atom')]);
      const indiana = articles.find((a) => a.title.startsWith('Indiana'));

      // The comments link comes first in the document; the article link is
      // the one marked rel="alternate".
      expect(indiana?.link).toBe('https://www.offtackleempire.com/latest-news/50083/indiana-defense');
      // Atom's <id> is a permalink identifier ("?p=50083"), never the URL.
      expect(indiana?.id).toBe(indiana?.link);
    });

    it('decodes entities in a CDATA-wrapped Atom title', async () => {
      respondPerUrl({ 'https://a.test/atom': { body: atomValid } });

      const { articles } = await fetchFeeds([source('a', 'https://a.test/atom')]);

      expect(articles.some((a) => a.title === "Indiana's defense travels well")).toBe(true);
    });

    it('falls back to <updated> when an entry has no <published>', async () => {
      respondPerUrl({ 'https://a.test/atom': { body: atomValid } });

      const { articles } = await fetchFeeds([source('a', 'https://a.test/atom')]);
      const indiana = articles.find((a) => a.title.startsWith('Indiana'));

      expect(indiana?.publishedAt).toBe('2026-08-08T16:00:00.000Z');
    });

    it('falls back to <content> for the description when there is no <summary>', async () => {
      respondPerUrl({ 'https://a.test/atom': { body: atomValid } });

      const { articles } = await fetchFeeds([source('a', 'https://a.test/atom')]);
      const indiana = articles.find((a) => a.title.startsWith('Indiana'));

      expect(indiana?.description).toBe('The Hoosiers held Purdue to 61 rushing yards.');
    });

    it('handles a bare-string title, a rel-less link, and media:thumbnail', async () => {
      respondPerUrl({ 'https://a.test/atom': { body: atomValid } });

      const { articles } = await fetchFeeds([source('a', 'https://a.test/atom')]);
      const bare = articles.find((a) => a.title === 'Bare text title with a thumbnail');

      // rel is optional in Atom and defaults to "alternate".
      expect(bare?.link).toBe('https://www.offtackleempire.com/latest-news/50082/bare-title');
      expect(bare?.imageUrl).toBe(
        'https://platform.offtackleempire.com/wp-content/uploads/thumb.jpg',
      );
    });

    it('sorts and dedupes across mixed RSS and Atom sources', async () => {
      respondPerUrl({
        'https://a.test/rss': { body: rssValid },
        'https://b.test/atom': { body: atomValid },
      });

      const { articles, failedSources } = await fetchFeeds([
        source('a', 'https://a.test/rss'),
        source('b', 'https://b.test/atom'),
      ]);

      expect(failedSources).toEqual([]);
      expect(articles).toHaveLength(5);
      const dates = articles.map((a) => a.publishedAt);
      expect(dates).toEqual([...dates].sort().reverse());
    });
  });

  // Yahoo Sports is an aggregator: 50 items from 27 different outlets, none
  // written by Yahoo. Surveyed across all 35 in-app feeds, it is the only
  // one that emits an item-level <source> at all.
  describe('syndicated items', () => {
    const syndicated = (itemSourceName: string) => ({
      'https://a.test/rss': {
        body: `<?xml version="1.0"?><rss><channel><title>Aggregator</title><item>
          <title>Smith enters the portal</title>
          <link>https://example.com/a</link>
          <source url="https://www.fansided.com">${itemSourceName}</source>
        </item></channel></rss>`,
      },
    });

    // Tier 1 feed, so the naive behaviour would badge FanSided "Newsroom".
    const tierOneFeed = (id: string, url: string): FeedSource => ({
      id,
      name: id,
      url,
      tier: 1,
    });

    it('credits the outlet that actually wrote it', async () => {
      respondPerUrl(syndicated('FanSided'));

      const { articles } = await fetchFeeds([tierOneFeed('Yahoo Sports', 'https://a.test/rss')]);

      expect(articles[0].source).toBe('FanSided');
    });

    // The point of the whole change: a rating is earned by the feed, and
    // passing it on to an outlet nobody assessed is a false claim on the one
    // axis this app exists to be honest about.
    it('does not inherit the aggregator’s tier', async () => {
      respondPerUrl(syndicated('FanSided'));

      const { articles } = await fetchFeeds([tierOneFeed('Yahoo Sports', 'https://a.test/rss')]);

      expect(articles[0].tier).toBe(0);
      expect(tierLabel(articles[0].tier)).toBe('Unrated');
    });

    it('keeps the feed’s own tier when <source> just repeats the feed name', async () => {
      respondPerUrl(syndicated('Yahoo Sports'));

      const { articles } = await fetchFeeds([tierOneFeed('Yahoo Sports', 'https://a.test/rss')]);

      expect(articles[0].source).toBe('Yahoo Sports');
      expect(articles[0].tier).toBe(1);
    });

    it('compares the name case-insensitively', async () => {
      respondPerUrl(syndicated('yahoo sports'));

      const { articles } = await fetchFeeds([tierOneFeed('Yahoo Sports', 'https://a.test/rss')]);

      expect(articles[0].tier).toBe(1);
    });

    it('leaves an ordinary feed with no <source> untouched', async () => {
      respondPerUrl({ 'https://a.test/rss': { body: rssValid } });

      const { articles } = await fetchFeeds([tierOneFeed('MLive', 'https://a.test/rss')]);

      expect(articles[0].source).toBe('MLive');
      expect(articles[0].tier).toBe(1);
    });
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
