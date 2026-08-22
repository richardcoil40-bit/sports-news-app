import bundledLeagues from '@/lib/__data__/leagues.json';
import { fetchWithTimeout } from '@/lib/http';
import { League } from '@/lib/leagues';

/**
 * Which leagues the app knows about.
 *
 * Leagues are **data, not code**. The list lives in `__data__/leagues.json`
 * rather than as exported constants, because the goal is that adding the NFL
 * is a data change and never an app release. That file is still bundled —
 * it is the shipped default and the offline fallback — but it is no longer
 * the only source: `refreshLeagueCatalog` fetches the same document from the
 * Worker in `worker/` and installs it over the bundled copy, so a new league
 * reaches every install on a `wrangler deploy` rather than through the App
 * Store.
 *
 * The validation below was written for exactly this day and did not change
 * to meet it. `parseLeagues` was already as defensive as if the input came
 * from a stranger, because validating a trusted file is nearly free and
 * retrofitting validation onto a live feed after it ships is not.
 *
 * ## The one rule that matters here
 *
 * **A catalog that can't be read must never install as an empty list.** Every
 * tab, filter, favorite and per-team fetch keys off this list, so an empty
 * one is an empty app that looks like it loaded correctly — the same reason
 * `teams.ts` throws on a non-OK response instead of degrading to `[]`. So the
 * fetch takes that same posture: `fetchLeagueCatalog` *throws* on anything it
 * can't turn into at least one available league, and `refreshLeagueCatalog`
 * catches that and leaves the app on the last list it could actually read.
 * Falling back is the caller's job; producing nothing is never this module's
 * answer.
 *
 * With `EXPO_PUBLIC_CATALOG_URL` unset, nothing here touches the network at
 * all and the catalog is the bundled file, exactly as it was before any of
 * this existed — the same hard requirement `verdicts.ts` holds itself to.
 */

/** Months are zero-based, matching `Date#getMonth`. */
const MAX_MONTH_INDEX = 11;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalString(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value.trim() : undefined;
}

function optionalInteger(value: unknown, { min, max }: { min: number; max: number }): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  if (value < min || value > max) return undefined;
  return value;
}

/**
 * Validates one entry, returning null rather than throwing.
 *
 * Optional fields that are present but malformed are dropped to
 * `undefined` instead of invalidating the whole league: a bad
 * `seasonStartMonth` costs a wrong stats year, whereas rejecting the league
 * costs the user every team in it. A missing *required* field is different —
 * there is no sensible URL to build without a sport and a league path.
 */
function parseLeague(raw: unknown): League | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  if (
    !isNonEmptyString(record.id) ||
    !isNonEmptyString(record.displayName) ||
    !isNonEmptyString(record.espnSport) ||
    !isNonEmptyString(record.espnLeaguePath)
  ) {
    return null;
  }

  return {
    id: record.id.trim(),
    displayName: record.displayName.trim(),
    sport: optionalString(record.sport),
    level: optionalString(record.level),
    // Anything that isn't exactly "planned" — including junk — reads as
    // available. The failure this way round is a league offered before
    // it works; the other way round is a working league hidden by a typo
    // in a field that has nothing to do with whether it works.
    status: record.status === 'planned' ? 'planned' : undefined,
    espnSport: record.espnSport.trim(),
    espnLeaguePath: record.espnLeaguePath.trim(),
    espnGroup: optionalInteger(record.espnGroup, { min: 0, max: Number.MAX_SAFE_INTEGER }),
    seasonStartMonth: optionalInteger(record.seasonStartMonth, { min: 0, max: MAX_MONTH_INDEX }),
  };
}

/**
 * Parses a whole catalog. Invalid entries are dropped individually rather
 * than failing the document, so one malformed league can never take the
 * others down — the same tolerate-partial-failure posture the feed layer
 * takes with `Promise.allSettled`.
 *
 * Duplicate ids keep the first occurrence. Ids are cache keys, so two
 * leagues answering to one id would serve each other's team lists.
 */
export function parseLeagues(raw: unknown): League[] {
  if (!Array.isArray(raw)) return [];

  const leagues: League[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    const league = parseLeague(entry);
    if (!league || seen.has(league.id)) continue;
    seen.add(league.id);
    leagues.push(league);
  }

  return leagues;
}

/** A league with no `status` is one the app can actually serve. */
function isAvailable(league: League): boolean {
  return league.status !== 'planned';
}

/**
 * The bundled catalog, parsed once. Falling back to this is what makes the
 * remote catalog safe: a fetch that fails, times out, or returns nonsense
 * leaves the app on the last list it could actually read.
 */
const BUNDLED: League[] = parseLeagues(bundledLeagues);

if (BUNDLED.filter(isAvailable).length === 0) {
  // Only reachable if the checked-in JSON is broken, which the tests cover.
  // Loud rather than silent: an empty catalog is an app with no teams, and
  // that must never look like a network problem. Counted over the
  // *available* leagues, since a catalog of nothing but planned ones is
  // just as empty from the app's point of view.
  throw new Error('Bundled league catalog has no available leagues — check src/lib/__data__/leagues.json');
}

/**
 * The catalog in force right now: the bundled list until a remote one is
 * successfully installed over it, and never anything else. Nothing assigns
 * to this but `install`, and `install` is only reachable from a value that
 * already cleared `fetchLeagueCatalog`'s non-empty check.
 */
let current: League[] = BUNDLED;

/**
 * `getLeagues()`'s answer, held rather than refiltered per call. It is read
 * from three render paths and from every followed-teams fetch, and it
 * allocated a fresh array each time — which also meant a fresh identity, so
 * a `useMemo` keyed on it never hit. Invalidated by `install`, which is the
 * only thing that can change the answer.
 */
let available: League[] | null = null;

type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * Notifies screens that the catalog changed under them. Same shape as
 * `favorites.ts`'s store and for the same reason: the pickers read the
 * catalog during render, and a remote list that lands a moment after they
 * mount would otherwise sit unseen until the screen happened to remount.
 * Bind to it with `useLeagueCatalog`.
 */
export function subscribeToLeagueCatalog(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function install(leagues: League[]) {
  current = leagues;
  available = null;
  for (const listener of listeners) listener();
}

/**
 * The leagues the app can actually serve. This is what every data path
 * should use — a planned league has no sources and no verified team
 * list, so handing one to a fetch produces an empty screen that looks
 * like a bug.
 */
export function getLeagues(): League[] {
  if (!available) available = current.filter(isAvailable);
  return available;
}

/**
 * Every league in the catalog, planned ones included. Only the Favorites
 * picker wants this: it shows what's coming as well as what works, which
 * is the one place a league you can't select is worth seeing.
 */
export function getCatalogLeagues(): League[] {
  return current;
}

export function getLeague(id: string): League | null {
  return current.find((league) => league.id === id) ?? null;
}

/**
 * The league used when a caller doesn't name one. Deliberately "the first
 * league in the catalog" rather than a hardcoded reference to the Big Ten:
 * the point of this file is that no module should have a conference baked
 * into it, and a default named BIG_TEN in eight call sites is exactly that.
 *
 * Bound to the **bundled** catalog rather than to whatever is in force, and
 * that is a decision rather than an oversight. Its callers are resolving an
 * *absent* league id — a favorite written by a build that predates
 * league-qualified keys, or a deep link that arrived without one — and those
 * are questions about what this build shipped with, not about what the
 * server said this morning. A remote reorder quietly changing which league a
 * legacy favorite migrates into would be the worse behaviour, and it would
 * be invisible.
 */
export const DEFAULT_LEAGUE: League = BUNDLED.filter(isAvailable)[0];

/**
 * Where the catalog is served from — the same Worker as `/v1/classify`, so
 * this is its base URL and not a second service. Unset means "bundled only,
 * no network", which is how every build behaved before this existed.
 */
function catalogUrl(): string | undefined {
  const url = process.env.EXPO_PUBLIC_CATALOG_URL;
  return url && url.trim() ? url.replace(/\/+$/, '') : undefined;
}

/**
 * Reads a catalog off the network, or throws.
 *
 * This is `teams.ts`'s posture, for `teams.ts`'s reason, and it is the one
 * thing in this file that is easy to get backwards. Every other remote source
 * in `src/lib/` degrades to empty because it is supplementary — a screen
 * missing stat leaders still works. A league list is not supplementary: the
 * tab bar, the filters and every per-team fetch key off it, so `[]` is an
 * empty app that renders as though it loaded fine. Three failures all have to
 * land as a throw and not as a short list:
 *
 * - a non-OK response,
 * - a body that isn't JSON at all (`response.json()` rejects on its own),
 * - a body that parses but yields no *available* league — an empty array, an
 *   array of junk `parseLeagues` dropped entry by entry, or a catalog of
 *   nothing but planned entries, which is just as empty from the app's point
 *   of view.
 *
 * A document that yields *some* leagues is a success even if it also
 * contained junk. That is the same line the feed layer draws between "a
 * publisher had a quiet day" and "this source is broken", and dropping bad
 * entries individually is what `parseLeagues` has always done.
 */
export async function fetchLeagueCatalog(baseUrl: string): Promise<League[]> {
  const response = await fetchWithTimeout(`${baseUrl}/v1/leagues`);
  if (!response.ok) throw new Error(`League catalog responded ${response.status}`);

  const leagues = parseLeagues(await response.json());
  if (leagues.filter(isAvailable).length === 0) {
    throw new Error('League catalog had no available leagues');
  }
  return leagues;
}

/** Shared so a second caller joins the first request instead of opening another. */
let refreshing: Promise<boolean> | null = null;

/**
 * Fetches the catalog and installs it, or keeps whatever is already in force.
 *
 * This is the half that falls back. `fetchLeagueCatalog` refuses to hand back
 * anything unusable, so everything reaching the `catch` is a reason to stay
 * on the current list — and staying is always safe, because the list in force
 * is either the bundled one or a remote one that already passed the same
 * check. Returns whether a new catalog was installed.
 *
 * Called once from the root layout and deliberately not awaited by anything:
 * blocking launch on this would trade a working app on a bundled catalog for
 * a spinner on a slow network. The consequence is a race no bigger than it
 * sounds — a picker mounted in the first few hundred milliseconds may render
 * the bundled list — and `subscribeToLeagueCatalog` is what closes it.
 */
export async function refreshLeagueCatalog(options?: { force?: boolean }): Promise<boolean> {
  if (refreshing && !options?.force) return refreshing;

  refreshing = (async () => {
    const baseUrl = catalogUrl();
    if (!baseUrl) return false;

    try {
      install(await fetchLeagueCatalog(baseUrl));
      return true;
    } catch (err) {
      // Loud, because the whole point of a hosted catalog is that a league
      // added on the server shows up here — and an app quietly running on a
      // months-old bundled list looks exactly like an app that is up to date.
      console.warn('[league-catalog] remote catalog unavailable, using the bundled one', err);
      return false;
    }
  })();

  return refreshing;
}
