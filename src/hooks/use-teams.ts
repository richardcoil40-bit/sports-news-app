import { useCallback, useEffect, useRef, useState } from 'react';

import { League } from '@/lib/leagues';
import { fetchTeams, Team } from '@/lib/teams';

/**
 * A league's teams. Defaults to the catalog's default league, which is
 * what every screen but the Favorites picker wants — the picker is the
 * one place that asks for a league by name.
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
      const result = await fetchTeams(league);
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
