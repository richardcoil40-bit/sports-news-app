import { XMLParser } from 'fast-xml-parser';

import { createSingletonCache } from '@/lib/cache';
import { FETCH_TIMEOUT_MS } from '@/lib/http';

/**
 * How far a source is trusted. Assigned by the criteria in
 * docs/source-reliability.md, not by how well-known the outlet is.
 *   1 — professional newsroom (masthead, corrections policy, original reporting)
 *   2 — credible independent (named staff, real reporting, lighter formal standards)
 *   3 — community / fan perspective
 */
export type SourceTier = 1 | 2 | 3;

/**
 * Whether everything a source publishes is already about one team.
 *   'team'  — a team-specific site; take all of it.
 *   'broad' — a general sports section covering pro teams and other sports
 *             too, so it has to be filtered down to the team by name.
 */
export type SourceScope = 'team' | 'broad';

/**
 * Who a source covers — a separate axis from tier, and the distinction
 * tier deliberately can't make.
 *
 *   'national' — covers the whole sport (ESPN, CBS, Yahoo).
 *   'beat'     — covers one team or region full-time: the metro paper's
 *                beat writer, the team blog, the student paper.
 *
 * These are orthogonal on purpose. MLive, the Seattle Times and the
 * Lincoln Journal Star are all Tier 1 professional newsrooms, exactly
 * like ESPN — so filtering by tier can't separate national wire coverage
 * from the reporter who watches your team every day. That's a real thing
 * to want, and it needs its own dimension.
 */
export type SourceReach = 'national' | 'beat';

export interface FeedSource {
  id: string;
  name: string;
  url: string;
  tier?: SourceTier;
  scope?: SourceScope;
  reach?: SourceReach;
}

/** College football RSS feeds only — no scraping. */
/**
 * The national pool — sources that cover the whole sport rather than any
 * one team. Off Tackle Empire (conference-wide) and Extra Points (the
 * business of college sports) are both wider than a single program, so
 * they count as national here even though neither is a big TV network.
 */
export const FEED_SOURCES: FeedSource[] = [
  { id: 'espn-cfb', name: 'ESPN', url: 'https://www.espn.com/espn/rss/ncf/news', tier: 1, scope: 'broad', reach: 'national' },
  { id: 'cbs-cfb', name: 'CBS Sports', url: 'https://www.cbssports.com/rss/headlines/college-football/', tier: 1, scope: 'broad', reach: 'national' },
  { id: 'yahoo-cfb', name: 'Yahoo Sports', url: 'https://sports.yahoo.com/college-football/rss.xml', tier: 1, scope: 'broad', reach: 'national' },
  { id: 'off-tackle-empire', name: 'Off Tackle Empire', url: 'https://www.offtackleempire.com/rss/index.xml', tier: 3, scope: 'broad', reach: 'national' },
  { id: 'extra-points', name: 'Extra Points', url: 'https://extrapoints.substack.com/feed', tier: 2, scope: 'broad', reach: 'national' },
];

export interface Article {
  id: string;
  title: string;
  link: string;
  description: string;
  source: string;
  author: string | null;
  publishedAt: string | null;
  imageUrl: string | null;
  tier: SourceTier;
  reach: SourceReach;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
});

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

/** dc:creator is the common RSS extension for bylines; plain <author> is the fallback. */
function extractAuthor(item: Record<string, unknown>): string | null {
  const raw = item['dc:creator'] ?? item.author;
  if (typeof raw !== 'string') return null;
  const cleaned = decodeHtmlEntities(raw.trim());
  return cleaned || null;
}

/**
 * Set EXPO_PUBLIC_DEBUG_FEEDS=1 (or flip DEBUG_TIMING below) to log how long
 * each individual feed takes and whether it succeeded, failed, or hit the
 * 10s timeout. Added to debug reports of the news pool "loading forever" —
 * every fetch here has a timeout, so if the pool as a whole still hangs
 * well past ~10s, this pinpoints which source (or confirms it's none of
 * them, i.e. the hang is somewhere else, like parsing or a downstream
 * consumer).
 */
const DEBUG_TIMING = false;

async function fetchFeed(source: FeedSource): Promise<Article[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const startedAt = Date.now();
  if (DEBUG_TIMING) console.log(`[feeds] → ${source.name} start`);

  try {
    const response = await fetch(source.url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${source.name} responded ${response.status}`);
    const xml = await response.text();
    const parsed = xmlParser.parse(xml);
    const rawItems: Record<string, unknown>[] = parsed?.rss?.channel?.item ?? [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];

    const articles = items
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
          author: extractAuthor(item),
          publishedAt: parsePubDate(item.pubDate),
          imageUrl: extractImageUrl(item),
          tier: source.tier ?? 3,
          // A team-specific site is a beat source by definition. Local
          // newsrooms are broad-scoped but still beat coverage, so
          // community-sources.ts tags those explicitly rather than
          // relying on this fallback.
          reach: source.reach ?? (source.scope === 'team' ? 'beat' : 'national'),
        };
      });

    if (DEBUG_TIMING) {
      console.log(`[feeds] ✓ ${source.name} done in ${Date.now() - startedAt}ms (${articles.length} items)`);
    }
    return articles;
  } catch (err) {
    if (DEBUG_TIMING) {
      const reason = err instanceof Error ? err.message : String(err);
      console.log(`[feeds] ✗ ${source.name} failed after ${Date.now() - startedAt}ms: ${reason}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export interface FetchAllResult {
  articles: Article[];
  failedSources: string[];
}

function dedupeAndSort(articleLists: Article[][]): Article[] {
  const articles: Article[] = [];
  const seenLinks = new Set<string>();

  for (const list of articleLists) {
    for (const article of list) {
      if (seenLinks.has(article.link)) continue;
      seenLinks.add(article.link);
      articles.push(article);
    }
  }

  articles.sort((a, b) => {
    if (!a.publishedAt) return 1;
    if (!b.publishedAt) return -1;
    return b.publishedAt.localeCompare(a.publishedAt);
  });

  return articles;
}

/** Fetches an arbitrary list of RSS sources, tolerating individual failures. */
export async function fetchFeeds(sources: FeedSource[]): Promise<FetchAllResult> {
  const results = await Promise.allSettled(sources.map(fetchFeed));

  const failedSources: string[] = [];
  const fulfilled: Article[][] = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') fulfilled.push(result.value);
    else failedSources.push(sources[index].name);
  });

  return { articles: dedupeAndSort(fulfilled), failedSources };
}

/**
 * The general pool (ESPN/CBS/Yahoo, ~3 feeds including one that runs
 * fairly large) gets re-requested by a lot of screens — team news,
 * recruiting, and every player detail page all pull from it. Without
 * caching, tapping from team → player was re-fetching and re-parsing all
 * three feeds from scratch every single time, which is most of what made
 * navigation feel slow. Cached for a few minutes; pull-to-refresh on the
 * News tab passes `force: true` to bypass it.
 */
const CACHE_TTL_MS = 3 * 60 * 1000;
const allFeedsCache = createSingletonCache<FetchAllResult>({ ttlMs: CACHE_TTL_MS });

export async function fetchAllFeeds(options?: { force?: boolean }): Promise<FetchAllResult> {
  return allFeedsCache.get(() => fetchFeeds(FEED_SOURCES), { force: options?.force });
}
