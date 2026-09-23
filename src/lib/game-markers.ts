/**
 * Where you last looked, per game: the id of the newest play on screen the
 * last time you left a game screen. It is what splits "since you looked"
 * from "earlier".
 *
 * In memory only, deliberately. The case this serves — look, go read the
 * feed, come back a drive later — happens inside one process. A cold
 * relaunch mid-game shows the whole game instead, which is a fine answer
 * and costs no persisted store (see docs/data-retention.md).
 *
 * No subscribers, also deliberately, for the reason `read-articles.ts`
 * learned from `caught-up.ts`: advancing a mark while the reader is looking
 * at the screen it splits would empty the section in front of them. The
 * screen reads it on the way in and writes it on the way out, and nothing
 * re-renders in between.
 */

/** A handful of games per Saturday; twenty is a season's worth of headroom. */
export const MAX_MARKERS = 20;

const markers = new Map<string, string>();

export function getGameMarker(key: string): string | null {
  return markers.get(key) ?? null;
}

export function setGameMarker(key: string, playId: string): void {
  // Delete-then-set moves the key to the newest end, so the Map's own
  // insertion order is the eviction order.
  markers.delete(key);
  markers.set(key, playId);
  while (markers.size > MAX_MARKERS) {
    const oldest = markers.keys().next();
    if (oldest.done) break;
    markers.delete(oldest.value);
  }
}

export function clearGameMarker(key: string): void {
  markers.delete(key);
}
