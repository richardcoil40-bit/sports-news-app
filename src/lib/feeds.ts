import { XMLParser, XMLValidator } from 'fast-xml-parser';

import { FETCH_TIMEOUT_MS } from '@/lib/http';

/**
 * How far a source is trusted. Assigned by the criteria in
 * docs/source-reliability.md, not by how well-known the outlet is.
 *   0 — not assessed (see below)
 *   1 — professional newsroom (masthead, corrections policy, original reporting)
 *   2 — credible independent (named staff, real reporting, lighter formal standards)
 *   3 — community / fan perspective
 *
 * Tier 0 is deliberately *not* "bad". It means nobody has applied the
 * criteria to this outlet, which is a different statement from "this outlet
 * is a fan blog" — and conflating the two is exactly the mislabeling this
 * tier exists to prevent. Tier 3 is a description of what a source is; tier
 * 0 is an admission of what the app doesn't know.
 */
export type SourceTier = 0 | 1 | 2 | 3;

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
 * RSS's `<source url="…">Name</source>` names the outlet an item was
 * *republished from*, which need not be the feed serving it.
 *
 * Surveyed across all 35 in-app feeds on 2026-08-18: exactly one uses it.
 * Yahoo Sports is an aggregator — 50 items drawn from 27 different outlets
 * (SB Nation, Trojans Wire, Detroit Free Press, HEAVY…), none of them
 * written by Yahoo. Attributing those to "Yahoo Sports" is simply false,
 * and inheriting Yahoo's Tier 1 puts a "Newsroom" badge on outlets nobody
 * has assessed.
 */
function extractItemSourceName(item: Record<string, unknown>): string | null {
  const cleaned = decodeHtmlEntities(textOf(item.source).trim());
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

  // An item that names a *different* outlet than the feed serving it was
  // syndicated. Credit the outlet that wrote it, and drop the tier to
  // unrated: the feed's rating was earned by the feed, and passing it on to
  // 27 outlets nobody assessed is the mislabeling tier 0 exists to stop.
  // Renaming without re-rating would be worse than doing neither.
  const itemSource = extractItemSourceName(item);
  const syndicated =
    itemSource !== null && itemSource.toLowerCase() !== source.name.toLowerCase();

  return {
    id: link,
    title: decodeHtmlEntities(item.title.trim()),
    link,
    description: stripHtml(rawDescription),
    source: syndicated ? itemSource : source.name,
    author: extractAuthor(item),
    publishedAt: parsePubDate(item.pubDate),
    imageUrl: extractImageUrl(item),
    tier: syndicated ? 0 : (source.tier ?? 0),
    // Reach stays the feed's even when syndicated. It is a coverage-scope
    // claim rather than a trust claim, there is no "unknown" value for it,
    // and guessing in either direction would be worse than inheriting.
    //
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
    tier: source.tier ?? 0,
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
 * Which feeds exist — and their caching — deliberately live in
 * `source-catalog.ts`, not here. This module is *how* to fetch and parse a
 * feed; it holds no source data and knows nothing about leagues.
 */
