import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

import { briefCutoff } from '@/lib/brief';

/**
 * The brief's window: the last two days, held steady while the reader is
 * looking at it and rolled forward when they come back.
 *
 * **Why freeze it at all, now that it doesn't move on its own.** It used to
 * matter enormously — the cutoff advanced at every period boundary and
 * again whenever the reader reached the finish line, so deriving it live
 * emptied the list under their finger. That mechanism is gone (read marks
 * replaced it, see read-history.ts), and what is left is a much smaller
 * reason: `new Date()` returns a new object every render, and the feed
 * screen memoizes its sections on this value. An unfrozen cutoff would
 * re-split the whole feed on every render and hand a fresh array to a
 * FlatList that has no reason to re-render.
 *
 * **Re-derived on return**, so a session left open overnight isn't still
 * measuring two days from yesterday. Both signals mean the reader went away
 * and came back:
 *
 *   - the screen regaining focus (returning from another tab or a screen)
 *   - the app returning to the foreground
 *
 * Returning from an article is one of those, and it is now harmless: the
 * window only ever slides by however long the reader was gone, and anything
 * it does drop is at least two days old.
 */
export function useBrief() {
  const [cutoff, setCutoff] = useState(() => briefCutoff(new Date()));

  const refreeze = useCallback(() => setCutoff(briefCutoff(new Date())), []);

  // Returning to the tab. Fires on first focus too, which is harmless —
  // the window it computes is the one the initial state already holds.
  useFocusEffect(refreeze);

  useEffect(() => {
    const appState = { current: AppState.currentState };
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current !== 'active' && next === 'active') refreeze();
      appState.current = next;
    });
    return () => subscription.remove();
  }, [refreeze]);

  return { cutoff };
}
