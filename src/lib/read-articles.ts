import {
  addReadEntry,
  parseReadEntries,
  pruneReadEntries,
  ReadEntry,
} from '@/lib/read-history';
import { readValue, removeValue, writeValue } from '@/lib/storage';

/**
 * Which stories you've opened.
 *
 * A module-level store with subscribers, the same shape as favorites.ts —
 * and unlike caught-up.ts, the value this replaced, it **does** emit.
 * That file went out of its way not to, because advancing the catch-up mark
 * under a reader who was looking at the brief emptied the list in front of
 * them. A read mark can't do that: it restyles a row in place and never
 * removes one, so pushing it live is the whole point rather than the bug.
 *
 * The rules — what parses, what expires, what gets trimmed — are in
 * read-history.ts, where they can be tested without AsyncStorage. This half
 * is the disk and the subscribers.
 */

const READ_KEY = 'nofrills.readArticles';

/**
 * The mark this feature replaced. Removed once on first hydrate: nothing
 * reads it any more, so left alone it would sit on disk forever as a
 * timestamp no code can explain.
 */
const LEGACY_CAUGHT_UP_KEY = 'nofrills.lastCaughtUpAt';

let entries: ReadEntry[] = [];

/**
 * The rendered snapshot, replaced only when the data actually changes —
 * useSyncExternalStore compares by identity, so a fresh Set per call would
 * re-render every subscribed screen on every check. A Set rather than the
 * array because the callers ask one question, once per card:
 * `readLinks.has(article.link)`.
 */
let readLinks: ReadonlySet<string> = new Set();
let hydrated = false;

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeToReadArticles(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getReadLinks(): ReadonlySet<string> {
  return readLinks;
}

export function isReadHydrated(): boolean {
  return hydrated;
}

function snapshot() {
  readLinks = new Set(entries.map((entry) => entry.link));
}

async function persist() {
  await writeValue(READ_KEY, JSON.stringify(entries));
}

/**
 * Loads the marks into memory. Safe to call more than once — later calls
 * are no-ops, so the home screen, a team screen and the article screen
 * don't have to coordinate over who hydrates first.
 */
export async function hydrateReadArticles(): Promise<void> {
  if (hydrated) return;

  const raw = await readValue(READ_KEY);
  entries = pruneReadEntries(parseReadEntries(raw), Date.now());
  snapshot();

  hydrated = true;
  emit();

  // Write the pruned list back so expiry runs once rather than on every
  // launch. Skipped when nothing changed, so an ordinary launch doesn't
  // touch disk, and not awaited: losing it costs one repeated prune.
  if (raw && raw !== JSON.stringify(entries)) persist();

  // One-time tidy, fire and forget. A failure costs a stale key nothing
  // reads.
  removeValue(LEGACY_CAUGHT_UP_KEY);
}

/**
 * Records that the reader opened `link`.
 *
 * Hydrates first: the article screen can be the first thing to touch this
 * store on a deep link, and marking against an empty in-memory list would
 * write a file holding one entry over a week of real ones.
 *
 * Callers don't await it — nothing on screen should wait on a disk write —
 * so the mark lands in the Set before the write is issued.
 */
export async function markArticleRead(link: string): Promise<void> {
  if (!link) return;
  await hydrateReadArticles();
  // Already marked: no new state, no re-render, no write. Re-opening
  // therefore does *not* refresh the mark's age — addReadEntry would, but
  // the cheap check wins here. The cost is that a story read six days ago
  // and re-opened today loses its mark tomorrow, which is a week-old story
  // falling off a week-long cap, not a bug worth a disk write per tap.
  if (readLinks.has(link)) return;

  entries = addReadEntry(entries, link, new Date().toISOString());
  snapshot();
  emit();
  persist();
}

/** Drops every mark. Wired to the clear-all in Settings. */
export async function clearReadArticles(): Promise<void> {
  entries = [];
  readLinks = new Set();
  emit();
  await removeValue(READ_KEY);
}
