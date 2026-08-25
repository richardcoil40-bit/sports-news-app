import { describe, expect, it } from 'vitest';

import {
  MAX_ARTICLES_PER_TEAM,
  MAX_STORED_TEAMS,
  STORED_DESCRIPTION_CAP,
  StoredArticle,
  mergeWithStored,
  parseStoreIndex,
  parseStoredArticles,
  touchIndex,
  truncateDescription,
} from '@/lib/article-retention';
import { Article } from '@/lib/feeds';

const NOW = Date.parse('2026-08-25T12:00:00.000Z');
const DAYS = 24 * 60 * 60 * 1000;

const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function article(link: string, overrides: Partial<Article> = {}): Article {
  return {
    id: link,
    title: `Story at ${link}`,
    link,
    description: 'A short teaser.',
    source: 'The Tennessean',
    author: null,
    publishedAt: iso(1 * DAYS),
    imageUrl: null,
    tier: 1,
    reach: 'beat',
    scope: 'broad',
    ...overrides,
  };
}

function stored(link: string, overrides: Partial<StoredArticle> = {}): StoredArticle {
  return { ...article(link), firstSeenAt: iso(2 * DAYS), ...overrides };
}

describe('mergeWithStored', () => {
  it('appends unexpired stored-only articles after a fresh fetch', () => {
    const fresh = [article('https://a.test/new', { publishedAt: iso(0) })];
    const old = stored('https://a.test/old', { publishedAt: iso(3 * DAYS) });

    const { articles } = mergeWithStored(fresh, [old], NOW);

    expect(articles.map((a) => a.link)).toEqual(['https://a.test/new', 'https://a.test/old']);
  });

  it('lets fresh win a link collision, keeping the stored firstSeenAt', () => {
    const fresh = [article('https://a.test/x', { title: 'Corrected title' })];
    const old = stored('https://a.test/x', {
      title: 'Original title',
      firstSeenAt: iso(4 * DAYS),
    });

    const { articles, nextStored } = mergeWithStored(fresh, [old], NOW);

    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe('Corrected title');
    // The age of an article doesn't reset every time a feed re-serves it.
    expect(nextStored[0].firstSeenAt).toBe(iso(4 * DAYS));
  });

  it('drops stored articles older than the age cap', () => {
    const old = stored('https://a.test/ancient', { publishedAt: iso(8 * DAYS) });

    const { articles, nextStored } = mergeWithStored([], [old], NOW);

    expect(articles).toEqual([]);
    expect(nextStored).toEqual([]);
  });

  // The store only ever adds to a fetch. Some feeds legitimately serve
  // old items, and a live feed's contents are the publisher's call.
  it('never drops a fresh article, however old its date', () => {
    const fresh = [article('https://a.test/archival', { publishedAt: iso(30 * DAYS) })];

    const { articles } = mergeWithStored(fresh, [], NOW);

    expect(articles).toHaveLength(1);
  });

  it('ages an undated article from first sight instead of keeping it forever', () => {
    const undatedFresh = stored('https://a.test/undated-fresh', {
      publishedAt: null,
      firstSeenAt: iso(2 * DAYS),
    });
    const undatedStale = stored('https://a.test/undated-stale', {
      publishedAt: null,
      firstSeenAt: iso(8 * DAYS),
    });

    const { articles } = mergeWithStored([], [undatedFresh, undatedStale], NOW);

    expect(articles.map((a) => a.link)).toEqual(['https://a.test/undated-fresh']);
  });

  it('treats an unparseable date as expired rather than immortal', () => {
    const junkDate = stored('https://a.test/junk-date', {
      publishedAt: 'coming soon',
      firstSeenAt: 'also not a date',
    });

    const { articles } = mergeWithStored([], [junkDate], NOW);

    expect(articles).toEqual([]);
  });

  it('stamps firstSeenAt on newly stored articles', () => {
    const { nextStored } = mergeWithStored([article('https://a.test/new')], [], NOW);

    expect(nextStored[0].firstSeenAt).toBe(new Date(NOW).toISOString());
  });

  it('sorts merged output newest first with undated last', () => {
    const fresh = [
      article('https://a.test/mid', { publishedAt: iso(2 * DAYS) }),
      article('https://a.test/undated', { publishedAt: null }),
    ];
    const old = stored('https://a.test/newest', { publishedAt: iso(1 * DAYS) });

    const { articles } = mergeWithStored(fresh, [old], NOW);

    expect(articles.map((a) => a.link)).toEqual([
      'https://a.test/newest',
      'https://a.test/mid',
      'https://a.test/undated',
    ]);
  });

  it('truncates descriptions in the persisted copy but not the displayed one', () => {
    const longDescription = 'word '.repeat(200).trim();
    const fresh = [article('https://a.test/long', { description: longDescription })];

    const { articles, nextStored } = mergeWithStored(fresh, [], NOW);

    expect(articles[0].description).toBe(longDescription);
    expect(nextStored[0].description.length).toBeLessThanOrEqual(STORED_DESCRIPTION_CAP + 1);
    expect(nextStored[0].description.endsWith('…')).toBe(true);
  });

  it('caps the persisted list without capping the displayed one', () => {
    const fresh = Array.from({ length: MAX_ARTICLES_PER_TEAM + 20 }, (_, i) =>
      article(`https://a.test/${i}`, { publishedAt: iso(i * 1000) }),
    );

    const { articles, nextStored } = mergeWithStored(fresh, [], NOW);

    expect(articles).toHaveLength(MAX_ARTICLES_PER_TEAM + 20);
    expect(nextStored).toHaveLength(MAX_ARTICLES_PER_TEAM);
    // Newest survive the trim.
    expect(nextStored[0].link).toBe('https://a.test/0');
  });
});

describe('truncateDescription', () => {
  it('leaves short text alone', () => {
    expect(truncateDescription('short')).toBe('short');
  });

  it('cuts at a word boundary', () => {
    const text = `${'a'.repeat(290)} boundary overflowing`;
    const cut = truncateDescription(text);
    expect(cut).toBe(`${'a'.repeat(290)} boundary…`.slice(0, cut.length));
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).not.toContain('overflowing');
  });

  it('hard-cuts a single enormous token', () => {
    const cut = truncateDescription('a'.repeat(500));
    expect(cut.length).toBe(STORED_DESCRIPTION_CAP + 1);
  });
});

// The contract every parser of persisted or external data holds in this
// repo: junk degrades to empty (or drops the junk entries), never throws.
describe('parseStoredArticles', () => {
  const junkShapes: [string, string | null][] = [
    ['null raw', null],
    ['empty string', ''],
    ['not JSON', 'not json {'],
    ['a JSON object', '{"articles": []}'],
    ['a JSON number', '42'],
    ['array of junk', '[null, 42, "x", {}, {"link": 7}]'],
  ];

  for (const [label, raw] of junkShapes) {
    it(`degrades to empty for ${label}`, () => {
      expect(parseStoredArticles(raw)).toEqual([]);
    });
  }

  it('drops entries missing link, title, or firstSeenAt and keeps the rest', () => {
    const good = stored('https://a.test/good');
    const raw = JSON.stringify([
      good,
      { ...stored('https://a.test/no-title'), title: '' },
      { ...stored('https://a.test/no-seen'), firstSeenAt: undefined },
    ]);

    const parsed = parseStoredArticles(raw);

    expect(parsed.map((a) => a.link)).toEqual(['https://a.test/good']);
  });

  it('defaults malformed optional fields instead of trusting them', () => {
    const raw = JSON.stringify([
      {
        link: 'https://a.test/partial',
        title: 'Partial',
        firstSeenAt: iso(0),
        tier: 9,
        reach: 'galactic',
        scope: 'everything',
        publishedAt: 123,
        author: {},
      },
    ]);

    const [parsed] = parseStoredArticles(raw);

    expect(parsed.tier).toBe(0);
    expect(parsed.reach).toBe('national');
    expect(parsed.scope).toBe('broad');
    expect(parsed.publishedAt).toBeNull();
    expect(parsed.author).toBeNull();
    expect(parsed.id).toBe('https://a.test/partial');
  });

  it('round-trips what mergeWithStored persists', () => {
    const { nextStored } = mergeWithStored([article('https://a.test/rt')], [], NOW);

    expect(parseStoredArticles(JSON.stringify(nextStored))).toEqual(nextStored);
  });
});

describe('store index', () => {
  it('parses junk to empty', () => {
    expect(parseStoreIndex(null)).toEqual([]);
    expect(parseStoreIndex('nope')).toEqual([]);
    expect(parseStoreIndex('{"a":1}')).toEqual([]);
    expect(parseStoreIndex('[{"key":1},{"lastUsedAt":"x"}]')).toEqual([]);
  });

  it('touching a team moves it to most-recent and evicts nothing under the cap', () => {
    const entries = [
      { key: 'a', lastUsedAt: iso(3 * DAYS) },
      { key: 'b', lastUsedAt: iso(2 * DAYS) },
    ];

    const { index, evicted } = touchIndex(entries, 'a', iso(0));

    expect(evicted).toEqual([]);
    expect(index.map((e) => e.key)).toEqual(['b', 'a']);
  });

  it('evicts the least recently used team past the cap', () => {
    const entries = Array.from({ length: MAX_STORED_TEAMS }, (_, i) => ({
      key: `team-${i}`,
      // team-0 is the least recently used.
      lastUsedAt: iso((MAX_STORED_TEAMS - i) * 1000),
    }));

    const { index, evicted } = touchIndex(entries, 'team-new', iso(0));

    expect(evicted).toEqual(['team-0']);
    expect(index).toHaveLength(MAX_STORED_TEAMS);
    expect(index.at(-1)?.key).toBe('team-new');
  });
});
