import { XMLParser } from 'fast-xml-parser';

export interface FeedSource {
  id: string;
  name: string;
  url: string;
}

/** College football RSS feeds only — no scraping. */
export const FEED_SOURCES: FeedSource[] = [
  { id: 'espn-cfb', name: 'ESPN', url: 'https://www.espn.com/espn/rss/ncf/news' },
  { id: 'cbs-cfb', name: 'CBS Sports', url: 'https://www.cbssports.com/rss/headlines/college-football/' },
  { id: 'yahoo-cfb', name: 'Yahoo Sports', url: 'https://sports.yahoo.com/college-football/rss.xml' },
];

export interface Article {
  id: string;
  title: string;
  link: string;
  description: string;
  source: string;
  publishedAt: string | null;
  imageUrl: string | null;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
});

const FETCH_TIMEOUT_MS = 10000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

/**
 * CDATA-wrapped titles/descriptions are passed through verbatim by the XML
 * parser (entities aren't interpreted inside CDATA per spec), so sources
 * that pre-encode apostrophes etc. as literal "&#39;" text need decoding
 * here by hand.
 */
function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function firstImgSrc(html: string | undefined): string | null {
  if (!html) return null;
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function extractImageUrl(item: Record<string, unknown>): string | null {
  const enclosure = item.enclosure as
    | { '@_url'?: string; '@_type'?: string }
    | { '@_url'?: string; '@_type'?: string }[]
    | undefined;
  if (enclosure) {
    const single = Array.isArray(enclosure) ? enclosure[0] : enclosure;
    if (single?.['@_url'] && (!single['@_type'] || single['@_type'].startsWith('image'))) {
      return single['@_url'];
    }
  }

  const mediaContent = item['media:content'] as { '@_url'?: string } | { '@_url'?: string }[] | undefined;
  if (mediaContent) {
    const single = Array.isArray(mediaContent) ? mediaContent[0] : mediaContent;
    if (single?.['@_url']) return single['@_url'];
  }

  const mediaThumbnail = item['media:thumbnail'] as { '@_url'?: string } | undefined;
  if (mediaThumbnail?.['@_url']) return mediaThumbnail['@_url'];

  const contentEncoded = item['content:encoded'] as string | undefined;
  return firstImgSrc(contentEncoded) ?? firstImgSrc(item.description as string | undefined);
}

function parsePubDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function fetchFeed(source: FeedSource): Promise<Article[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(source.url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${source.name} responded ${response.status}`);
    const xml = await response.text();
    const parsed = xmlParser.parse(xml);
    const rawItems: Record<string, unknown>[] = parsed?.rss?.channel?.item ?? [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];

    return items
      .filter((item) => item && typeof item.link === 'string' && typeof item.title === 'string')
      .map((item): Article => {
        const link = (item.link as string).trim();
        const title = decodeHtmlEntities((item.title as string).trim());
        const rawDescription = typeof item.description === 'string' ? item.description : '';

        return {
          id: link,
          title,
          link,
          description: stripHtml(rawDescription),
          source: source.name,
          publishedAt: parsePubDate(item.pubDate),
          imageUrl: extractImageUrl(item),
        };
      });
  } finally {
    clearTimeout(timeout);
  }
}

export interface FetchAllResult {
  articles: Article[];
  failedSources: string[];
}

export async function fetchAllFeeds(): Promise<FetchAllResult> {
  const results = await Promise.allSettled(FEED_SOURCES.map(fetchFeed));

  const articles: Article[] = [];
  const failedSources: string[] = [];
  const seenLinks = new Set<string>();

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      for (const article of result.value) {
        if (seenLinks.has(article.link)) continue;
        seenLinks.add(article.link);
        articles.push(article);
      }
    } else {
      failedSources.push(FEED_SOURCES[index].name);
    }
  });

  articles.sort((a, b) => {
    if (!a.publishedAt) return 1;
    if (!b.publishedAt) return -1;
    return b.publishedAt.localeCompare(a.publishedAt);
  });

  return { articles, failedSources };
}
