import { XMLParser, XMLValidator } from 'fast-xml-parser';

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

/**
 * fast-xml-parser collapses a repeated element to a single value and only
 * produces an array when it sees more than one. Every "this might repeat"
 * read has to normalize, or a feed with one `<link>` and a feed with two
 * take different code paths.
 */
function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Atom carries a `type` attribute on its text constructs, so
 * `<title type="html">x</title>` parses to `{ '#text': 'x', '@_type': 'html' }`
 * while a bare `<title>x</title>` parses to the string `'x'`. Both shapes
 * appear in the wild — often in the same document — so nothing may assume
 * a text node is a string.
 */
function textOf(node: unknown): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (node && typeof node === 'object') {
    const text = (node as Record<string, unknown>)['#text'];
    if (typeof text === 'string') return text;
    if (typeof text === 'number') return String(text);
  }
  return '';
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

/**
 * The Media RSS extensions, which Atom and RSS both carry unchanged
 * because they're a separate namespace bolted onto either. Shared by both
 * shapes; only the fallback body differs (see the two callers below).
 */
function extractMediaUrl(item: Record<string, unknown>): string | null {
  const enclosure = item.enclosure as
    | { '@_url'?: string; '@_type'?: string }
    | { '@_url'?: string; '@_type'?: string }[]
    | undefined;
  const firstEnclosure = toArray(enclosure)[0];
  if (firstEnclosure?.['@_url']) {
    if (!firstEnclosure['@_type'] || firstEnclosure['@_type'].startsWith('image')) {
      return firstEnclosure['@_url'];
    }
  }

  const mediaContent = toArray(item['media:content'] as { '@_url'?: string } | { '@_url'?: string }[])[0];
  if (mediaContent?.['@_url']) return mediaContent['@_url'];

  const mediaThumbnail = toArray(item['media:thumbnail'] as { '@_url'?: string } | { '@_url'?: string }[])[0];
  if (mediaThumbnail?.['@_url']) return mediaThumbnail['@_url'];

  return null;
}

/** RSS: media extensions, then the first `<img>` in the body or the teaser. */
function extractImageUrl(item: Record<string, unknown>): string | null {
  const contentEncoded = item['content:encoded'] as string | undefined;
  return (
    extractMediaUrl(item) ??
    firstImgSrc(contentEncoded) ??
    firstImgSrc(item.description as string | undefined)
  );
}

/**
 * Atom: same media extensions, but the body is `<content>` and the teaser
 * is `<summary>` — and both are text constructs, so they need `textOf`
 * before an `<img>` can be looked for inside them.
 */
function extractAtomImageUrl(entry: Record<string, unknown>): string | null {
  return (
    extractMediaUrl(entry) ??
    firstImgSrc(textOf(entry.content)) ??
    firstImgSrc(textOf(entry.summary))
  );
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
 * Atom nests the byline: `<author><name>…</name></author>`, and a document
 * may carry several. Take the first — the UI shows one byline.
 */
function extractAtomAuthor(entry: Record<string, unknown>): string | null {
  const author = toArray(entry.author as Record<string, unknown> | Record<string, unknown>[])[0];
  const name = author ? textOf(author.name) : '';
  const cleaned = decodeHtmlEntities(name.trim());
  return cleaned || null;
}

/**
 * Atom's `<link>` is an element with attributes rather than a text node,
 * repeats freely, and only one of them is the article. `rel="alternate"`
 * is the canonical human-readable page per RFC 4287; `rel` is also
 * *optional* and defaults to alternate, which is why a link with no `rel`
 * counts. Anything explicitly labelled `replies`, `enclosure` or `edit`
 * must not be mistaken for the article.
 */
function extractAtomLink(entry: Record<string, unknown>): string | null {
  const links = toArray(entry.link as unknown);

  for (const candidate of links) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
      continue;
    }
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Record<string, unknown>;
    const rel = record['@_rel'];
    const href = record['@_href'];
    if (typeof href !== 'string' || !href.trim()) continue;
    if (rel === undefined || rel === 'alternate') return href.trim();
  }

  // No alternate link, but something has an href — better a working link
  // to the wrong representation than dropping the article entirely.
  for (const candidate of links) {
    if (!candidate || typeof candidate !== 'object') continue;
    const href = (candidate as Record<string, unknown>)['@_href'];
    if (typeof href === 'string' && href.trim()) return href.trim();
  }

  return null;
}

/**
 * The two shapes this app understands. Detected from the parsed document
 * rather than the Content-Type header, which feeds get wrong constantly
 * (several serve Atom as `application/rss+xml`).
 */
export type FeedFormat = 'rss' | 'atom';

interface DetectedFeed {
  format: FeedFormat;
  /**
   * Straight off the XML parser, so genuinely unknown — a feed can carry
   * `<item>text</item>` or a self-closing `<entry/>`, which parse to a
   * string and to an empty string respectively, not to objects. fetchFeed
   * narrows these in one place rather than each mapper re-checking.
   */
  items: unknown[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/**
 * Returns null when the document is well-formed XML but not a feed at all
 * — an HTML error page that happens to parse, an API error document, a
 * sitemap. The caller turns that into a reported failure; see fetchFeed.
 *
 * Note this deliberately accepts a feed with *zero* items. A publisher
 * having a quiet day is not a broken source, and conflating the two is
 * how seventeen dead sources went unnoticed for months.
 */
function detectFeed(parsed: unknown): DetectedFeed | null {
  const root = asRecord(parsed);
  if (!root) return null;

  const rssChannel = asRecord(asRecord(root.rss)?.channel);
  if (rssChannel) {
    return { format: 'rss', items: toArray(rssChannel.item as unknown) };
  }

  const atomFeed = asRecord(root.feed);
  if (atomFeed) {
    return { format: 'atom', items: toArray(atomFeed.entry as unknown) };
  }

  return null;
}

function articleFromRssItem(item: Record<string, unknown>, source: FeedSource): Article | null {
  if (typeof item.link !== 'string' || typeof item.title !== 'string') return null;

  const link = item.link.trim();
  if (!link) return null;

  const rawDescription = typeof item.description === 'string' ? item.description : '';

  return {
    id: link,
    title: decodeHtmlEntities(item.title.trim()),
    link,
    description: stripHtml(rawDescription),
    // NOT read from the item-level `<source url="…">Name</source>`, even
    // though Stage 3's discovery lane will need that. Yahoo's feed is an
    // aggregator — 50 items from 31 different outlets on 2026-08-18 —
    // so reading it would relabel those articles correctly while still
    // stamping them with Yahoo's tier 1, putting a false "Newsroom" badge
    // on FanSided and HEAVY. It needs the unrated tier that arrives with
    // the source registry; renaming without re-rating is worse than not
    // renaming.
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
}

function articleFromAtomEntry(entry: Record<string, unknown>, source: FeedSource): Article | null {
  const link = extractAtomLink(entry);
  const title = decodeHtmlEntities(textOf(entry.title).trim());
  if (!link || !title) return null;

  // `<summary>` is the teaser; `<content>` is the whole post. Prefer the
  // teaser and fall back to stripping the body, which is what the RSS
  // path effectively does with description vs content:encoded.
  const rawDescription = textOf(entry.summary) || textOf(entry.content);

  return {
    // Atom's <id> is a permanent identifier, not a URL — SB Nation emits
    // "https://site.com/?p=50084" there. Keying off the link instead
    // keeps ids comparable with the RSS path, which every dedupe in the
    // app already relies on.
    id: link,
    title,
    link,
    description: stripHtml(rawDescription),
    source: source.name,
    author: extractAtomAuthor(entry),
    // <published> is when it went up; <updated> is mandatory in Atom and
    // is the only date many feeds set, so it has to be the fallback.
    publishedAt: parsePubDate(entry.published ?? entry.updated),
    imageUrl: extractAtomImageUrl(entry),
    tier: source.tier ?? 3,
    reach: source.reach ?? (source.scope === 'team' ? 'beat' : 'national'),
  };
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

    // Gate 1: is this well-formed XML at all? This has to run before
    // parsing, because the parser is deliberately lenient — handed a
    // truncated document it silently nests the unclosed elements and
    // produces a structurally plausible channel with no items, which is
    // indistinguishable from a healthy feed on a quiet day. Validating
    // first is what separates "broken" from "nothing published today".
    const validation = XMLValidator.validate(xml, { allowBooleanAttributes: true });
    if (validation !== true) {
      throw new Error(`${source.name} served malformed XML: ${validation.err?.msg ?? 'unknown'}`);
    }

    // Gate 2: is it a feed we understand? Well-formed XML that is an HTML
    // error page, a JSON-ish error document or a sitemap lands here.
    const parsed = xmlParser.parse(xml);
    const detected = detectFeed(parsed);
    if (!detected) {
      throw new Error(`${source.name} served well-formed XML that is not an RSS or Atom feed`);
    }

    const mapItem = detected.format === 'rss' ? articleFromRssItem : articleFromAtomEntry;
    const articles = detected.items
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => mapItem(item, source))
      .filter((article): article is Article => article !== null);

    if (DEBUG_TIMING) {
      console.log(
        `[feeds] ✓ ${source.name} done in ${Date.now() - startedAt}ms (${detected.format}, ${articles.length} items)`,
      );
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
