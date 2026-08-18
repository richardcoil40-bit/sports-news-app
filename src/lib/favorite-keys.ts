/**
 * How a followed team is identified in storage.
 *
 * ESPN team ids are unique only *within a sport*: id 13 is the Los Angeles
 * Lakers in the NBA and a different team entirely in college football. The
 * app originally stored bare ids, which is fine with exactly one league and
 * silently wrong the moment there are two — you would follow the Lakers and
 * get a college football team's news.
 *
 * So a stored favorite is `"<leagueId>:<teamId>"`.
 *
 * Deliberately split out of `favorites.ts`: that module reaches disk through
 * `storage.ts` and therefore pulls in AsyncStorage, which can't load in the
 * plain-Node test environment. The parsing and migration rules are the part
 * worth testing, so they live somewhere they can be.
 */

const SEPARATOR = ':';

export interface FavoriteRef {
  leagueId: string;
  teamId: string;
}

export function favoriteKey(leagueId: string, teamId: string): string {
  return `${leagueId}${SEPARATOR}${teamId}`;
}

/**
 * Splits on the *first* separator only. League ids are ours and contain no
 * colon, but ESPN ids are not ours to guarantee, so anything after the first
 * colon belongs to the team id rather than being silently truncated.
 */
export function parseFavoriteKey(key: string): FavoriteRef | null {
  if (typeof key !== 'string') return null;

  const index = key.indexOf(SEPARATOR);
  if (index <= 0) return null;

  const leagueId = key.slice(0, index);
  const teamId = key.slice(index + SEPARATOR.length);
  if (!leagueId || !teamId) return null;

  return { leagueId, teamId };
}

/**
 * Brings persisted favorites up to the qualified format.
 *
 * This has to keep working indefinitely, not just for one release. The value
 * lives on the user's device and there is no server to migrate it from, so a
 * user who skips several versions still arrives here with the old shape.
 *
 * An unqualified entry is assumed to belong to `fallbackLeagueId`, which is
 * correct because bare ids could only ever have been written when the app had
 * a single league.
 *
 * Junk is dropped rather than repaired: this value survives app upgrades, so
 * a future version writing a format this one doesn't understand must not be
 * able to crash it. Duplicates are collapsed — following one team twice is
 * meaningless and would render the row twice.
 */
export function migrateFavoriteIds(stored: unknown, fallbackLeagueId: string): string[] {
  if (!Array.isArray(stored)) return [];

  const migrated: string[] = [];
  const seen = new Set<string>();

  for (const entry of stored) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const key = parseFavoriteKey(trimmed)
      ? trimmed
      : favoriteKey(fallbackLeagueId, trimmed);

    if (seen.has(key)) continue;
    seen.add(key);
    migrated.push(key);
  }

  return migrated;
}
