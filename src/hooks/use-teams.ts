import { useCallback, useEffect, useRef, useState } from 'react';

import { League } from '@/lib/leagues';
import { fetchAllTeams, fetchTeams, Team } from '@/lib/teams';

/**
 * Teams, from one league or from all of them.
 *
 * Naming a league scopes it — that's the Favorites picker, which walks
 * Sport → Level → League and so has a league in hand. Every other screen
 * omits it and gets every available league, because what those screens
 * actually do is resolve *followed* teams, and a favorite is stored
 * league-qualified: holding one league's list can only ever resolve the
 * favorites that happen to be in it. That was invisible while the Big Ten
 * was the only league and became a bug the moment the SEC was added.
 */
export function useTeams(league?: League) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // If reload() fires again before the first call resolves (e.g. a fast
  // double pull-to-refresh), only the most recently started call should be
  // allowed to write to state — otherwise a slow first response landing
  // after a fast second one silently overwrites newer data with older data.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = league ? await fetchTeams(league) : await fetchAllTeams();
      if (id !== requestId.current) return;
      setTeams(result);
    } catch {
      if (id !== requestId.current) return;
      setError('Could not load teams. Check your connection and try again.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
    // Keyed on the id rather than the descriptor: getLeague() hands back a
    // fresh object per call, so depending on the object itself would
    // reload on every render forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league?.id]);

  useEffect(() => {
    // Fetch-on-mount: load() sets `loading` synchronously before awaiting.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { teams, loading, error, reload: load };
}
