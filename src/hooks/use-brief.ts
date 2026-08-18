import { useCallback, useEffect, useRef, useState } from 'react';

import { briefCutoff } from '@/lib/brief';
import {
  getLastCaughtUpAt,
  hydrateCaughtUp,
  isCaughtUpHydrated,
  markCaughtUp,
} from '@/lib/caught-up';
import { currentPeriodLabel, currentPeriodStart } from '@/lib/refresh-schedule';

/**
 * Holds the brief's window steady for as long as the screen is on screen.
 *
 * The trap this exists to avoid: the moment the reader reaches the end of
 * the brief, the mark advances — and if the cutoff were derived live, every
 * story in front of them would immediately fall out of the window and the
 * list would empty under their finger.
 *
 * So the cutoff is computed **once per mount** and frozen. Reaching the end
 * writes the new mark to disk but changes nothing on screen; the next time
 * the screen mounts, it reads the updated mark and the brief is legitimately
 * empty. That's the behaviour you want — "you're caught up" should be true
 * when you come back, not the instant you get there.
 */
export function useBrief() {
  const [hydrated, setHydrated] = useState(isCaughtUpHydrated);

  useEffect(() => {
    let cancelled = false;
    hydrateCaughtUp().then(() => {
      if (!cancelled) setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Deliberately lazy state rather than a memo: a memo recomputes when its
  // dependencies change, and the whole point here is that this must not.
  const [frozen, setFrozen] = useState<{ cutoff: Date; periodLabel: string } | null>(null);

  useEffect(() => {
    if (!hydrated || frozen) return;
    const now = new Date();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFrozen({
      cutoff: briefCutoff({
        now,
        periodStart: currentPeriodStart(now),
        lastCaughtUpAt: getLastCaughtUpAt(),
      }),
      periodLabel: currentPeriodLabel(now),
    });
  }, [hydrated, frozen]);

  // Once per mount. Reaching the end of the brief repeatedly — scrolling
  // past the marker, back up, and past it again — should not rewrite the
  // mark each time.
  const marked = useRef(false);
  const reachedEnd = useCallback(() => {
    if (marked.current) return;
    marked.current = true;
    markCaughtUp();
  }, []);

  return {
    ready: hydrated && frozen !== null,
    cutoff: frozen?.cutoff ?? null,
    periodLabel: frozen?.periodLabel ?? '',
    reachedEnd,
  };
}
