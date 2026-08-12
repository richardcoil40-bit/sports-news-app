import { readValue, writeValue } from '@/lib/storage';

/**
 * The teams you follow. This is the piece of state that turns the app
 * from a directory of every Big Ten team into a feed of the two or three
 * you actually care about, so it's read by nearly every screen.
 *
 * Implemented as a module-level store with subscribers rather than React
 * context, for two reasons: starring a team on the Teams tab has to
 * immediately update the home feed on a different tab (context would
 * work, but would mean wrapping the tree and re-rendering more of it than
 * necessary), and the persistence layer underneath isn't React-aware
 * anyway. Screens bind to it with the useFavorites hook.
 */

const FAVORITES_KEY = 'nofrills.favoriteTeamIds';
const ONBOARDED_KEY = 'nofrills.hasOnboarded';

/**
 * Held as an array rather than a Set specifically so it can be handed to
 * useSyncExternalStore as a stable snapshot: the reference only changes
 * when the data actually changes, which is what stops every subscribed
 * screen from re-rendering on unrelated updates.
 */
let favoriteIds: string[] = [];
let hydrated = false;

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeToFavorites(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFavoriteIds(): string[] {
  return favoriteIds;
}

export function isHydrated(): boolean {
  return hydrated;
}

export function isFavorite(teamId: string): boolean {
  return favoriteIds.includes(teamId);
}

/**
 * Loads persisted favorites into memory. Safe to call more than once —
 * later calls are no-ops, so screens don't have to coordinate over who
 * hydrates first.
 */
export async function hydrateFavorites(): Promise<void> {
  if (hydrated) return;

  const raw = await readValue(FAVORITES_KEY);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      // Guard the shape rather than trusting it: this value survives app
      // upgrades, so a future version writing a different format
      // shouldn't be able to crash this one on launch.
      if (Array.isArray(parsed)) {
        favoriteIds = parsed.filter((id): id is string => typeof id === 'string');
      }
    } catch {
      favoriteIds = [];
    }
  }

  hydrated = true;
  emit();
}

async function persist() {
  await writeValue(FAVORITES_KEY, JSON.stringify(favoriteIds));
}

export function toggleFavorite(teamId: string) {
  favoriteIds = favoriteIds.includes(teamId)
    ? favoriteIds.filter((id) => id !== teamId)
    : [...favoriteIds, teamId];
  emit();
  // Not awaited: the UI shouldn't wait on a disk write to show a star
  // filling in. A failed write is already handled (and logged) in
  // storage.ts by falling back to memory.
  persist();
}

export function setFavorites(teamIds: string[]) {
  favoriteIds = [...teamIds];
  emit();
  persist();
}

/** Whether the first-launch team picker has been completed. */
export async function hasOnboarded(): Promise<boolean> {
  return (await readValue(ONBOARDED_KEY)) === 'true';
}

export async function markOnboarded(): Promise<void> {
  await writeValue(ONBOARDED_KEY, 'true');
}
