import { useCallback, useEffect, useState } from 'react';

import { fetchBigTenTeams, Team } from '@/lib/teams';

export function useTeams() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTeams(await fetchBigTenTeams());
    } catch {
      setError('Could not load teams. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { teams, loading, error, reload: load };
}
