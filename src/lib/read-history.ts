/**
 * The retention rules for the read-marks store: what a persisted mark has
 * to look like, what expires, and what gets trimmed.
 *
 * ## Why marks exist at all
 *
 * The brief used to move its own cutoff forward — at every morning/noon/
 * night boundary, and again the moment the reader reached the finish line
 * — so opening a story and coming back retired everything that had been on
 * screen a second earlier. Nothing was deleted, but from the reader's chair
 * the feed emptied itself several times a day.
 *
 * So the window stopped moving (it is simply the last two days now) and the
 * app remembers what you opened instead. A story you read stays exactly
 * where it was, marked; the cap counts unread only. That only works if the
 * marks outlive the process, which makes this the one persisted value that
 * genuinely *is* a reading history — see docs/data-retention.md for the
 * bounds that keep it proportionate.
 *
 * ## Why this file is separate from read-articles.ts
 *
 * Same split as favorite-keys.ts / favorites.ts and
 * article-retention.ts / article-store.ts, for the same reason: the disk
 * half reaches AsyncStorage through storage.ts, which can't load in the
 * plain-Node test environment. The rules are the part worth testing, so
 * they live where they can be.
 */

/**
 * One opened story. `link` and nothing else — see the doc note: a link is a
 * public URL identical for every reader, where a title or a team would say
 * something about *this* reader.
 */
export interface ReadEntry {
  link: string;
  /**
   * When it was opened, and what ages it out. `addReadEntry` refreshes it
   * on a repeat mark rather than stacking a second entry — though the store
   * above short-circuits an already-marked link before it gets here, so in
   * practice this is when the story was *first* opened.
   */
  readAt: string;
}

/**
 * Cap by age: a week, matching MAX_ARTICLE_AGE_MS in article-retention.ts.
 * A mark outliving the article it marks would never be shown and never be
 * cleared, so the two bounds are deliberately the same length.
 */
export const MAX_READ_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cap by count. Well above a week of heavy reading (the brief shows twelve
 * at a time), so it is a backstop against a runaway file rather than a
 * limit anyone reaches.
 */
export const MAX_READ_ENTRIES = 500;

/**
 * Same junk posture as parseStoredArticles: a value that survives app
 * upgrades is read as if a future version wrote it. Bad entries are dropped
 * individually rather than failing the whole file — the same line the feed
 * layer draws between a quiet publisher and a broken source.
 */
export function parseReadEntries(raw: string | null): ReadEntry[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const entries: ReadEntry[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.link !== "string" || !record.link) continue;
    if (typeof record.readAt !== "string" || !record.readAt) continue;
    entries.push({ link: record.link, readAt: record.readAt });
  }

  return entries;
}

/**
 * Drops what has aged out and trims what is left to the count cap, newest
 * first.
 *
 * Always returns the list ordered newest-first rather than only when it had
 * to sort: nothing persisted guarantees an order, and "keep the newest 500"
 * has to mean the same thing whatever order arrived from disk.
 *
 * An unparseable `readAt` is treated as already expired, for
 * article-retention's reason: a mark that can't age would otherwise live
 * forever.
 */
export function pruneReadEntries(
  entries: ReadEntry[],
  now: number,
): ReadEntry[] {
  const live: { entry: ReadEntry; at: number }[] = [];

  for (const entry of entries) {
    const at = Date.parse(entry.readAt);
    if (Number.isNaN(at)) continue;
    if (now - at > MAX_READ_AGE_MS) continue;
    live.push({ entry, at });
  }

  live.sort((a, b) => b.at - a.at);

  return live.slice(0, MAX_READ_ENTRIES).map(({ entry }) => entry);
}

/**
 * Records that `link` was opened.
 *
 * Any existing entry for the same link is replaced rather than added
 * alongside, so reopening a story refreshes its `readAt` instead of
 * accumulating a per-open log. That is what keeps this a set of links with
 * an age on each, rather than a record of when you read.
 */
export function addReadEntry(
  entries: ReadEntry[],
  link: string,
  nowIso: string,
): ReadEntry[] {
  const parsed = Date.parse(nowIso);
  const now = Number.isNaN(parsed) ? Date.now() : parsed;

  return pruneReadEntries(
    [{ link, readAt: nowIso }, ...entries.filter((e) => e.link !== link)],
    now,
  );
}
