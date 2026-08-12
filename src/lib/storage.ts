import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The app's only persistent store. Everything else in lib/ caches in
 * memory and forgets on quit (see docs/data-retention.md) — this is the
 * one exception, because "the teams you follow" is worthless if it
 * resets every launch.
 *
 * Deliberately a tiny key/value surface rather than exposing AsyncStorage
 * directly: every persisted thing in the app goes through here, so
 * there's one place to see everything that touches disk, one place to
 * add a clear-all, and one file to change if the backing store ever
 * needs to be something other than AsyncStorage.
 *
 * Reads and writes swallow their errors and fall back to an in-memory
 * map. A device that can't write to disk should mean "your teams don't
 * survive a restart," not a crash on launch — same tolerate-partial-
 * failure posture the network layer takes.
 */

const memoryFallback = new Map<string, string>();

export async function readValue(key: string): Promise<string | null> {
  try {
    const stored = await AsyncStorage.getItem(key);
    if (stored !== null) return stored;
  } catch (err) {
    console.warn(`[storage] read failed for "${key}", using in-memory value`, err);
  }
  return memoryFallback.get(key) ?? null;
}

export async function writeValue(key: string, value: string): Promise<void> {
  memoryFallback.set(key, value);
  try {
    await AsyncStorage.setItem(key, value);
  } catch (err) {
    console.warn(`[storage] write failed for "${key}", kept in memory only`, err);
  }
}
