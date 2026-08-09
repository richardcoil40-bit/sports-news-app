import { XMLParser } from 'fast-xml-parser';

export type FootballCategory = 'nfl' | 'college' | 'highschool';

export interface FeedSource {
  id: string;
  name: string;
  category: FootballCategory;
  url: string;
}

/**
 * RSS feeds only — no scraping. Each source is a reputable sports outlet's
 * official feed. Google News is used for high school football since no
 * national outlet publishes a dedicated feed for it; the query is scoped
 * tightly to the sport so results stay on-topic.
 */
export const FEED_SOURCES: FeedSource[] = [
  { id: 'espn-nfl', name: 'ESPN', category: 'nfl', url: 'https://www.espn.com/espn/rss/nfl/news' },
  { id: 'cbs-nfl', name: 'CBS Sports', category: 'nfl', url: 'https://www.cbssports.com/rss/headlines/nfl/' },
  { id: 'yahoo-nfl', name: 'Yahoo Sports', category: 'nfl', url: 'https://sports.yahoo.com/nfl/rss.xml' },
  { id: 'espn-cfb', name: 'ESPN', category: 'college', url: 'https://www.espn.com/espn/rss/ncf/news' },
  {
    id: 'cbs-cfb',
    name: 'CBS Sports',
    category: 'college',
    url: 'https://www.cbssports.com/rss/headlines/college-football/',
  },
  {
    id: 'yahoo-cfb',
    name: 'Yahoo Sports',
    category: 'college',
    url: 'https://sports.yahoo.com/college-football/rss.xml',
  },
  {
    id: 'google-hs',
    name: 'Google News',
    category: 'highschool',
    url: 'https://news.google.com/rss/search?q=%22high+school+football%22&hl=en-US&gl=US&ceid=US:en',
  },
];

export interface Article {
  id: string;
  title: string;
  link: string;
  description: string;
  source: string;
  category: FootballCategory;
  publishedAt: string | null;
  imageUrl: string | null;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
});

const FETCH_TIMEOUT_MS = 10000;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Google News titles look like "Headline text - Publisher Name". */
function splitGoogleNewsTitle(raw: string): { title: string; publisher: string | null } {
  const idx = raw.lastIndexOf(' - ');
  if (idx === -1) return { title: raw, publisher: null };
  return { title: raw.slice(0, idx), publisher: raw.slice(idx + 3) };
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
        let title = (item.title as string).trim();
        let sourceName = source.name;

        if (source.id === 'google-hs') {
          const split = splitGoogleNewsTitle(title);
          title = split.title;
          if (split.publisher) sourceName = split.publisher;
        }

        const rawDescription = typeof item.description === 'string' ? item.description : '';

        return {
          id: link,
          title,
          link,
          description: stripHtml(rawDescription),
          source: sourceName,
          category: source.category,
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
