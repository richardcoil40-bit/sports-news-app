import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

import { briefCutoff } from '@/lib/brief';
import {
  getLastCaughtUpAt,
  hydrateCaughtUp,
  isCaughtUpHydrated,
  markCaughtUp,
} from '@/lib/caught-up';
import { currentPeriodLabel, currentPeriodStart } from '@/lib/refresh-schedule';

interface Window {
  cutoff: Date;
  periodLabel: string;
}

function computeWindow(): Window {
  const now = new Date();
  const periodStart = currentPeriodStart(now);
  const cutoff = briefCutoff({ now, periodStart, lastCaughtUpAt: getLastCaughtUpAt() });

  // The label has to describe the window that was actually used. Once the
  // catch-up mark overtakes the period start, "since midday" would be a
  // false claim about a brief that really starts later than that — and the
  // marker is only worth having while everything on it is true.
  return {
    cutoff,
    periodLabel:
      cutoff.getTime() > periodStart.getTime() ? 'you last looked' : currentPeriodLabel(now),
  };
}

/**
 * Holds the brief's window steady while the reader is looking at it, and
 * re-derives it when they come back.
 *
 * **Steady while looking.** The moment the reader reaches the end, the
 * catch-up mark advances. If the cutoff were derived live, every story in
 * front of them would immediately fall out of the window and the list would
 * empty under their finger. So the window is computed once and frozen.
 *
 * **Re-derived on return.** "Once per mount" is not enough on its own: tab
 * screens stay mounted, so a mount-only window would only ever advance on a
 * cold launch. It would also never roll into the next morning/noon/night
 * period during a long session, leaving fresh content stacked under a label
 * that says "since this morning". So the window is recomputed on two
 * signals, both of which mean the reader went away and came back:
 *
 *   - the screen regaining focus (returning from another tab or a screen)
 *   - the app returning to the foreground
 *
 * Neither can fire while the reader is mid-scroll, which is what keeps the
 * list stable at the one moment stability matters.
 */
export function useBrief() {
  const [hydrated, setHydrated] = useState(isCaughtUpHydrated);
  const [window, setWindow] = useState<Window | null>(null);

  // Whether this window's end has already been recorded. Reset with the
  // window, so a *new* window can be caught up on in turn, but not
  // re-recorded every time the reader scrolls past the marker twice.
  const marked = useRef(false);

  const refreeze = useCallback(() => {
    if (!isCaughtUpHydrated()) return;
    marked.current = false;
    setWindow(computeWindow());
  }, []);

  useEffect(() => {
    let cancelled = false;
    hydrateCaughtUp().then(() => {
      if (cancelled) return;
      setHydrated(true);
      setWindow(computeWindow());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Returning to the tab. Fires on first focus too, which is harmless —
  // the window it computes is the same one hydration just produced.
  useFocusEffect(refreeze);

  useEffect(() => {
    const appState = { current: AppState.currentState };
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current !== 'active' && next === 'active') refreeze();
      appState.current = next;
    });
    return () => subscription.remove();
  }, [refreeze]);

  /**
   * Records that the reader reached the end of the brief.
   *
   * `seen` is the caller's assertion that the brief was actually looked at
   * rather than merely rendered — see the scroll guard in the feed screen.
   * A brief shorter than the viewport reaches its "end" during initial
   * layout, and marking that as read would retire stories nobody scrolled
   * to.
   */
  const reachedEnd = useCallback((seen: boolean) => {
    if (!seen || marked.current) return;
    marked.current = true;
    markCaughtUp();
  }, []);

  return {
    ready: hydrated && window !== null,
    cutoff: window?.cutoff ?? null,
    periodLabel: window?.periodLabel ?? '',
    reachedEnd,
  };
}
