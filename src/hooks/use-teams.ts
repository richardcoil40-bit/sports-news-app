import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchTeams, Team } from '@/lib/teams';

export function useTeams() {
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
      const result = await fetchTeams();
      if (id !== requestId.current) return;
      setTeams(result);
    } catch {
      if (id !== requestId.current) return;
      setError('Could not load teams. Check your connection and try again.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { teams, loading, error, reload: load };
}
