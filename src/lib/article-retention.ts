import type { Article } from '@/lib/feeds';

/**
 * The retention rules for the on-device article store: what survives a
 * merge, what expires, and what gets trimmed.
 *
 * ## Why a store exists at all
 *
 * Every fetch cache in lib/ is in-memory with a short TTL and dies with
 * the process, and several sources are rolling windows (a news sitemap is
 * ~48h; an SB Nation feed is ten items). So a thin team's feed was
 * permanently capped at whatever exists *right now* — Vanderbilt landed
 * around ten articles no matter how often the app was opened. Remembering
 * what was already fetched turns that into several dozen over a week,
 * for every low-coverage team at once, without adding a single source.
 * It also means a cold launch with no network has last week's news to
 * show instead of nothing.
 *
 * ## Why this file is separate from article-store.ts
 *
 * Same split as favorite-keys.ts / favorites.ts, for the same reason: the
 * disk half reaches AsyncStorage through storage.ts, which can't load in
 * the plain-Node test environment. The rules are the part worth testing,
 * so they live where they can be.
 */

/** An article as persisted: the pool's own shape plus when we first saw it. */
export interface StoredArticle extends Article {
  /**
   * When this device first saw the article. `publishedAt` is nullable
   * (see feeds.ts on publishers that render dates instead of encoding
   * them), and an item with no date has no age — nothing would ever purge
   * it. Aging undated items from first sight is what keeps the store from
   * accumulating them forever.
   */
  firstSeenAt: string;
}

/** Cap by age: a week, then out. */
export const MAX_ARTICLE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Cap by count, per team. */
export const MAX_ARTICLES_PER_TEAM = 60;
/**
 * Cap by team count, matching the in-memory pool cache's `maxEntries` —
 * the two bounds answer the same question at two lifetimes.
 */
export const MAX_STORED_TEAMS = 50;
/**
 * Descriptions are truncated on persist. They exist for name matching and
 * off-topic detection, both of which work on a prefix — and the fresh copy
 * of any article still in a live feed wins the merge with its full text,
 * so only items that survive *solely* from the store carry the cap. Those
 * render a clipped teaser over the "Read full article" button, which is
 * the app's premise anyway.
 */
export const STORED_DESCRIPTION_CAP = 300;

export function truncateDescription(text: string): string {
  if (text.length <= STORED_DESCRIPTION_CAP) return text;
  const slice = text.slice(0, STORED_DESCRIPTION_CAP);
  const lastSpace = slice.lastIndexOf(' ');
  // Cut at a word boundary unless the text is one enormous token.
  const cut = lastSpace > STORED_DESCRIPTION_CAP / 2 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

function isExpired(article: StoredArticle, now: number): boolean {
  const born = Date.parse(article.publishedAt ?? article.firstSeenAt);
  // An unparseable date can't age, so it would otherwise live forever —
  // treat it as already expired rather than immortal.
  if (Number.isNaN(born)) return true;
  return now - born > MAX_ARTICLE_AGE_MS;
}

/** The pools' own ordering: newest first, undated last. */
function sortNewestFirst<T extends { publishedAt: string | null }>(articles: T[]): T[] {
  return [...articles].sort((a, b) => {
    if (!a.publishedAt) return 1;
    if (!b.publishedAt) return -1;
    return b.publishedAt.localeCompare(a.publishedAt);
  });
}

export interface MergeResult {
  /**
   * What the screen shows: everything fresh, plus unexpired stored
   * articles the live feeds no longer serve. Fresh objects pass through
   * untouched — full descriptions included — and the list is deliberately
   * not capped: the caps govern what is *persisted*, not what a healthy
   * live fetch may display.
   */
  articles: Article[];
  /** What to persist: capped, truncated, aged. */
  nextStored: StoredArticle[];
}

/**
 * Merge a fetch with what the store already holds.
 *
 * Fresh wins on a link collision — a corrected title or a late-arriving
 * image should update — but keeps the stored `firstSeenAt`, so an undated
 * article's age doesn't reset every time the feed re-serves it. The store
 * only ever *adds* to a fetch: expiry applies to stored-only items, never
 * to something a live feed is still serving. Pull-to-refresh goes through
 * this same path, which is why refreshing merges rather than clears.
 */
export function mergeWithStored(
  fresh: Article[],
  stored: StoredArticle[],
  now: number,
): MergeResult {
  const freshLinks = new Set(fresh.map((a) => a.link));
  const firstSeenByLink = new Map(stored.map((s) => [s.link, s.firstSeenAt]));

  const storedOnly = stored.filter((s) => !freshLinks.has(s.link) && !isExpired(s, now));
  const articles = sortNewestFirst([...fresh, ...storedOnly]);

  const nowIso = new Date(now).toISOString();
  const nextStored = articles
    .map(
      (a): StoredArticle => ({
        ...a,
        description: truncateDescription(a.description),
        firstSeenAt: firstSeenByLink.get(a.link) ?? nowIso,
      }),
    )
    // Newest-first with undated last, so the count cap drops the oldest
    // dated items and undated ones first — FIFO by date within the team.
    .slice(0, MAX_ARTICLES_PER_TEAM);

  return { articles, nextStored };
}

/**
 * Reads a persisted article list, trusting nothing about it. This value
 * survives app upgrades, so a future version writing a different shape
 * must degrade to an empty store, never crash a launch. Entries missing
 * the fields the app can't render without are dropped individually.
 */
export function parseStoredArticles(raw: string | null): StoredArticle[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const articles: StoredArticle[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.link !== 'string' || !record.link) continue;
    if (typeof record.title !== 'string' || !record.title) continue;
    if (typeof record.firstSeenAt !== 'string' || !record.firstSeenAt) continue;

    articles.push({
      id: typeof record.id === 'string' && record.id ? record.id : record.link,
      title: record.title,
      link: record.link,
      description: typeof record.description === 'string' ? record.description : '',
      source: typeof record.source === 'string' ? record.source : '',
      author: typeof record.author === 'string' ? record.author : null,
      publishedAt: typeof record.publishedAt === 'string' ? record.publishedAt : null,
      imageUrl: typeof record.imageUrl === 'string' ? record.imageUrl : null,
      tier:
        record.tier === 1 || record.tier === 2 || record.tier === 3 ? record.tier : 0,
      reach: record.reach === 'beat' ? 'beat' : 'national',
      scope: record.scope === 'team' ? 'team' : 'broad',
      // Kept so an article surviving only from the store still wears the
      // verdict it earned when live. Only the three remote values are
      // possible; anything else is junk and drops to absent.
      ...(record.remoteClaim === 'reported' ||
      record.remoteClaim === 'rumor' ||
      record.remoteClaim === 'take'
        ? { remoteClaim: record.remoteClaim }
        : {}),
      firstSeenAt: record.firstSeenAt,
    });
  }
  return articles;
}

// ---------------------------------------------------------------------------
// The LRU index over teams
// ---------------------------------------------------------------------------

export interface StoreIndexEntry {
  key: string;
  lastUsedAt: string;
}

/** Same junk posture as parseStoredArticles, for the index key. */
export function parseStoreIndex(raw: string | null): StoreIndexEntry[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const entries: StoreIndexEntry[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.key !== 'string' || !record.key) continue;
    if (typeof record.lastUsedAt !== 'string' || !record.lastUsedAt) continue;
    entries.push({ key: record.key, lastUsedAt: record.lastUsedAt });
  }
  return entries;
}

export interface TouchResult {
  index: StoreIndexEntry[];
  /** Keys evicted past the team cap — the caller deletes their data keys. */
  evicted: string[];
}

/**
 * Marks a team as just used and evicts least-recently-used teams beyond
 * the cap. A merge counts as a use, matching cache.ts's rule that a hit
 * refreshes recency.
 */
export function touchIndex(
  entries: StoreIndexEntry[],
  key: string,
  nowIso: string,
): TouchResult {
  const index = entries
    .filter((entry) => entry.key !== key)
    .sort((a, b) => a.lastUsedAt.localeCompare(b.lastUsedAt));
  index.push({ key, lastUsedAt: nowIso });

  const evicted: string[] = [];
  while (index.length > MAX_STORED_TEAMS) {
    evicted.push(index.shift()!.key);
  }
  return { index, evicted };
}
