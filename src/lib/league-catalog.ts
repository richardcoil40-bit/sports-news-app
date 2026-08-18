import bundledLeagues from '@/lib/__data__/leagues.json';
import { League } from '@/lib/leagues';

/**
 * Which leagues the app knows about.
 *
 * Leagues are **data, not code**. The list lives in `__data__/leagues.json`
 * rather than as exported constants, because the goal is that adding the NFL
 * is a data change and never an app release. Today that data is bundled; the
 * only thing that has to change for it to arrive over the network instead is
 * where `loadLeagues` reads from — the parsing, validation and fallback below
 * are already written for input that can't be trusted.
 *
 * That is also why `parseLeagues` is as defensive as it is despite currently
 * being handed a file from this repo. Validating a trusted file is nearly
 * free; retrofitting validation onto a live feed after it has already shipped
 * is not.
 */

/** Months are zero-based, matching `Date#getMonth`. */
const MAX_MONTH_INDEX = 11;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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

/**
 * The bundled catalog, parsed once. Falling back to this is what makes a
 * remote catalog safe to add later: a fetch that fails, times out, or
 * returns nonsense leaves the app on the last list it could actually read.
 */
const BUNDLED: League[] = parseLeagues(bundledLeagues);

if (BUNDLED.length === 0) {
  // Only reachable if the checked-in JSON is broken, which the tests cover.
  // Loud rather than silent: an empty catalog is an app with no teams, and
  // that must never look like a network problem.
  throw new Error('Bundled league catalog is empty or invalid — check src/lib/__data__/leagues.json');
}

export function getLeagues(): League[] {
  return BUNDLED;
}

export function getLeague(id: string): League | null {
  return BUNDLED.find((league) => league.id === id) ?? null;
}

/**
 * The league used when a caller doesn't name one. Deliberately "the first
 * league in the catalog" rather than a hardcoded reference to the Big Ten:
 * the point of this file is that no module should have a conference baked
 * into it, and a default named BIG_TEN in eight call sites is exactly that.
 */
export const DEFAULT_LEAGUE: League = BUNDLED[0];
