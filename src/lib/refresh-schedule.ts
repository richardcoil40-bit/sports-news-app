import { leagueIdsFrom } from '@/lib/favorite-keys';
import { getFavoriteIds, hydrateFavorites } from '@/lib/favorites';
import { mapWithConcurrency } from '@/lib/http';
import { fetchLeagueFeeds, leaguesWithNationalFeeds } from '@/lib/source-catalog';
import { readValue, writeValue } from '@/lib/storage';

/**
 * "3x a day" is a content-freshness target, not a network scheduler — the
 * app doesn't run anything while it's closed. Instead, every time the app
 * is opened or brought to the foreground, it checks whether the calendar
 * has moved into a new part of the day (morning / noon / night) since the
 * last time it refreshed, and if so, forces one fresh pull of the national
 * feed pool right away, before you tap into anything. Individual team news
 * pools already re-fetch on their own 3-minute cache, so this only needs to
 * handle the shared national pool that the News tab and every player
 * screen build on.
 *
 * The window marker is persisted. It used to be memory-only, which made a
 * cold launch *always* read `null` and *always* force a full cache-bypassing
 * pull — so the real cadence was "every cold start", not "3x a day". That was
 * defensible as behaviour on its own (reopening the app after a while does
 * show fresh content), and it stops being defensible on cost: this is the
 * largest fan-out in the app, and it grows with the number of leagues rather
 * than with anything the user did. Persisted, a relaunch inside the same
 * window costs nothing and the caches serve it.
 */

type Period = 'morning' | 'noon' | 'night';

const MORNING_STARTS_AT = 5; // 5:00
const NOON_STARTS_AT = 11; // 11:00
const NIGHT_STARTS_AT = 17; // 17:00

function periodFor(hour: number): Period {
  if (hour >= MORNING_STARTS_AT && hour < NOON_STARTS_AT) return 'morning';
  if (hour >= NOON_STARTS_AT && hour < NIGHT_STARTS_AT) return 'noon';
  return 'night';
}

/**
 * A stable key for "which refresh window are we in right now." Night runs
 * from 5pm to 5am, crossing midnight — hours before 5am are folded into the
 * *previous* calendar day's night window (rather than starting a new
 * "night" period at 12:00am) so the app doesn't treat 12:01am as a fresh
 * window and force an unnecessary refresh a few hours after the 5pm one.
 */
function periodKey(now: Date): string {
  const effectiveDate = new Date(now);
  if (now.getHours() < MORNING_STARTS_AT) {
    effectiveDate.setDate(effectiveDate.getDate() - 1);
  }
  // The LOCAL date, matching the local hours the windows are defined in.
  // This used to be toISOString()'s UTC date, which rolls over mid-window
  // in every timezone but UTC itself — 7pm Central, mid-evening — and a
  // key that changes mid-window forces a second full cache-bypassing pull
  // of a window that was already refreshed. Persisting the marker is what
  // made that waste worth fixing: the whole point of the persisted key is
  // that a window already refreshed stays refreshed.
  const dateStr = [
    effectiveDate.getFullYear(),
    String(effectiveDate.getMonth() + 1).padStart(2, '0'),
    String(effectiveDate.getDate()).padStart(2, '0'),
  ].join('-');
  return `${dateStr}-${periodFor(now.getHours())}`;
}

const LAST_REFRESHED_STORAGE_KEY = 'nofrills.lastRefreshedPeriod';

let lastRefreshedKey: string | null = null;
let diskRead: Promise<string | null> | null = null;

/**
 * The persisted marker, read once per process and held in memory after.
 *
 * Two things this has to survive, because launch and an AppState event can
 * fire in the same tick and both land here: the read is shared rather than
 * issued twice, and a value coming back from disk never overwrites a window
 * some other caller has already claimed in the meantime. Without the second
 * guard the later read resets the marker and a second full refresh runs.
 *
 * A read failure is indistinguishable from "never written" and is handled
 * the same way — as a missed window, costing one extra refresh. That is the
 * right direction to fail in: stale content is worse than a redundant fetch.
 */
async function loadLastRefreshedKey(): Promise<string | null> {
  if (lastRefreshedKey !== null) return lastRefreshedKey;

  diskRead ??= readValue(LAST_REFRESHED_STORAGE_KEY);
  const stored = await diskRead;
  if (lastRefreshedKey === null) lastRefreshedKey = stored;

  return lastRefreshedKey;
}

/**
 * How many leagues' national pools may be refreshed at once. Lower than the
 * app-wide default because this is prefetch — it runs before the user has
 * looked at anything, so nothing on screen is waiting on it, and each league
 * expands to a handful of parallel RSS fetches underneath.
 */
const REFRESH_CONCURRENCY = 3;

/**
 * When the current morning/noon/night window began.
 *
 * Exported because the brief is defined as "what arrived since this window
 * opened". The refresh cadence and the reading session are deliberately the
 * same boundary, so the app can only claim it has something new at a point
 * where it actually went and looked.
 *
 * Hours before 5am belong to the previous day's night window, matching
 * periodKey above: night runs 5pm to 5am, and treating midnight as a fresh
 * window would wipe the evening's brief a few hours after it appeared.
 */
export function currentPeriodStart(now: Date = new Date()): Date {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);

  const hour = now.getHours();
  if (hour >= NIGHT_STARTS_AT) {
    start.setHours(NIGHT_STARTS_AT);
  } else if (hour >= NOON_STARTS_AT) {
    start.setHours(NOON_STARTS_AT);
  } else if (hour >= MORNING_STARTS_AT) {
    start.setHours(MORNING_STARTS_AT);
  } else {
    // Before 5am — still last night's window, which began yesterday.
    start.setDate(start.getDate() - 1);
    start.setHours(NIGHT_STARTS_AT);
  }

  return start;
}

/** Which window we're in, for labelling the brief. */
export function currentPeriodLabel(now: Date = new Date()): string {
  const period = periodFor(now.getHours());
  return period === 'morning' ? 'this morning' : period === 'noon' ? 'midday' : 'this evening';
}

/**
 * Only the leagues the user actually follows a team in.
 *
 * This used to be every league with a national pool, which was two, and is
 * heading for forty-five. Nothing else reads those pools: a national feed
 * reaches the screen only through a followed team's news pool, so a league
 * you follow nobody in is five parallel cache-bypassing RSS fetches whose
 * results are never read by anything.
 *
 * A user following nobody prefetches nothing, which is correct rather than a
 * gap — there is no screen for it to warm.
 */
function followedLeaguesWithNationalFeeds() {
  const followed = new Set(leagueIdsFrom(getFavoriteIds()));
  return leaguesWithNationalFeeds().filter((league) => followed.has(league.id));
}

/**
 * Call on app launch and whenever the app returns to the foreground. Cheap
 * to call often — it's a no-op unless the period actually changed.
 */
export async function refreshIfNewPeriod(): Promise<boolean> {
  const key = periodKey(new Date());
  // Checked against the persisted marker, not just the in-memory one — the
  // whole point of persisting it is that a relaunch inside the same window
  // is a no-op rather than a full cache-bypassing pull.
  if (key === (await loadLastRefreshedKey())) return false;

  // Set eagerly so overlapping callers (mount plus an AppState event in the
  // same tick) don't both kick off a refresh: whichever gets here first
  // claims the window, and the check above is what the second one hits.
  lastRefreshedKey = key;
  // Not awaited, and safe to lose: a write that fails costs one redundant
  // refresh next launch, which is the same direction the read fails in.
  writeValue(LAST_REFRESHED_STORAGE_KEY, key);

  // Which leagues to warm is a question about the persisted favorites, and
  // this runs from app launch — early enough that the store may not have
  // been read yet. hydrateFavorites is idempotent, so this is a no-op
  // whenever the UI got there first.
  await hydrateFavorites();

  // Settled rather than awaited as a group, so one league's outage can't
  // leave the others stale, and rate-limited because this is the largest
  // fan-out in the app: each league here expands to every national feed it
  // has, all of them bypassing cache by definition.
  await mapWithConcurrency(followedLeaguesWithNationalFeeds(), REFRESH_CONCURRENCY, (league) =>
    fetchLeagueFeeds(league, { force: true }),
  );
  return true;
}
