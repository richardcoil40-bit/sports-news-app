import { fetchLeagueFeeds, leaguesWithNationalFeeds } from '@/lib/source-catalog';

/**
 * "3x a day" is a content-freshness target, not a network scheduler — the
 * app doesn't run anything while it's closed. Instead, every time the app
 * is opened or brought to the foreground, it checks whether the calendar
 * has moved into a new part of the day (morning / noon / night) since the
 * last time it refreshed, and if so, forces one fresh pull of the national
 * feed pool right away, before you tap into anything. Individual team news
 * pools already re-fetch on their own 3-minute cache, so this only needs to
 * handle the shared national pool that the News/Recruiting tabs and every
 * player screen build on.
 *
 * Tracked in memory only (no persisted storage) — a cold relaunch always
 * counts as a new check, which in practice means "reopening the app after
 * it's been closed for a while shows fresh content," a reasonable behavior
 * on its own even before the period logic kicks in.
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
  const dateStr = effectiveDate.toISOString().slice(0, 10);
  return `${dateStr}-${periodFor(now.getHours())}`;
}

let lastRefreshedKey: string | null = null;
let lastRefreshedAt: Date | null = null;

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

export function getLastRefreshedAt(): Date | null {
  return lastRefreshedAt;
}

/**
 * Call on app launch and whenever the app returns to the foreground. Cheap
 * to call often — it's a no-op unless the period actually changed.
 */
export async function refreshIfNewPeriod(): Promise<boolean> {
  const key = periodKey(new Date());
  if (key === lastRefreshedKey) return false;

  // Set eagerly so overlapping calls (e.g. mount + an AppState event firing
  // in the same tick) don't both kick off a refresh.
  lastRefreshedKey = key;

  try {
    // Every league that has one, not a named league: this runs before the
    // user has looked at anything, so it has no team or league context to
    // work from. Settled rather than awaited as a group, so one league's
    // outage can't leave the others stale.
    await Promise.allSettled(
      leaguesWithNationalFeeds().map((league) => fetchLeagueFeeds(league, { force: true })),
    );
  } finally {
    lastRefreshedAt = new Date();
  }
  return true;
}
