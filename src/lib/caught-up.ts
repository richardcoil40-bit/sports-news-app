import { readValue, writeValue } from '@/lib/storage';

/**
 * When the reader last reached the end of a brief.
 *
 * The third and last thing this app writes to disk, after the teams you
 * follow and the onboarding flag. It's what lets the brief mean "since you
 * last looked" rather than "since some fixed time" — and it has to survive
 * a relaunch or the app would greet you with the same stories every time
 * you open it.
 *
 * Same module-level-store-with-subscribers shape as favorites.ts, for the
 * same reasons: it's read from more than one screen, and the persistence
 * layer underneath isn't React-aware.
 */

const CAUGHT_UP_KEY = 'nofrills.lastCaughtUpAt';

let lastCaughtUpAt: Date | null = null;
let hydrated = false;

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeToCaughtUp(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLastCaughtUpAt(): Date | null {
  return lastCaughtUpAt;
}

export function isCaughtUpHydrated(): boolean {
  return hydrated;
}

/**
 * Safe to call more than once — later calls are no-ops, so screens don't
 * have to coordinate over who hydrates first.
 */
export async function hydrateCaughtUp(): Promise<void> {
  if (hydrated) return;

  const raw = await readValue(CAUGHT_UP_KEY);
  if (raw) {
    const parsed = Date.parse(raw);
    // Guard the shape rather than trusting it: this value survives app
    // upgrades, and an unreadable one should mean "never caught up", not a
    // crash on launch or an Invalid Date poisoning every comparison.
    if (!Number.isNaN(parsed)) lastCaughtUpAt = new Date(parsed);
  }

  hydrated = true;
  emit();
}

/**
 * Records that the reader reached the end of the brief.
 *
 * **Deliberately does not emit.** The screen that just called this is
 * looking at the brief right now, and telling it the mark moved would
 * empty the list under the reader's finger — the single worst bug this
 * feature can have. The new value is picked up on the next mount instead;
 * see the frozen cutoff in use-brief.ts.
 */
export function markCaughtUp(when: Date = new Date()) {
  lastCaughtUpAt = when;
  // Not awaited: nothing in the UI should wait on a disk write, and a
  // failed write costs one repeated brief, not correctness.
  writeValue(CAUGHT_UP_KEY, when.toISOString());
}
