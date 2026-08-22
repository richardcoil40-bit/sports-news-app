import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useFavorites } from '@/hooks/use-favorites';
import { leagueIdsFrom } from '@/lib/favorite-keys';
import { League } from '@/lib/leagues';
import { fetchAllTeams, fetchTeams, fetchTeamsForLeagues, Team } from '@/lib/teams';

/**
 * Teams, at one of three widths.
 *
 * - **No argument — the leagues you follow something in.** This is what
 *   nearly every screen wants, because what those screens actually do is
 *   resolve *followed* teams, and a favorite is stored league-qualified:
 *   the league ids are readable straight off the stored keys, so a league
 *   you follow nobody in is a standings request that never has to happen.
 *   With two leagues that saved one call. With forty-five it is the whole
 *   difference between a cold launch and a cold launch that opens
 *   forty-five sockets before it can render anything — and `use-feed.ts`
 *   blocks all news fetching until this resolves.
 * - **A league — just that one.** The Favorites picker walks
 *   Sport → Level → League and so has one in hand.
 * - **`'all'` — every available league.** Only the pickers: onboarding and
 *   Settings → Favorites are showing you what you *could* follow, so they
 *   are the one thing that can't be scoped by what you already do. On a
 *   first launch there are no favorites to scope by at all, which is
 *   exactly when onboarding runs.
 */
export function useTeams(scope?: League | 'all') {
  const { favoriteIds, hydrated } = useFavorites();

  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // If reload() fires again before the first call resolves (e.g. a fast
  // double pull-to-refresh), only the most recently started call should be
  // allowed to write to state — otherwise a slow first response landing
  // after a fast second one silently overwrites newer data with older data.
  const requestId = useRef(0);

  const followedLeagueIds = useMemo(() => leagueIdsFrom(favoriteIds), [favoriteIds]);
  const league = typeof scope === 'object' ? scope : null;
  const wantsEveryLeague = scope === 'all';

  /**
   * One primitive that fully decides what this hook fetches, and the only
   * thing the effect below depends on.
   *
   * Two reasons it's a single derived string rather than a dependency list.
   * A League is an object and the followed ids are a fresh array each
   * render, so depending on either directly is the "re-fires on every render
   * forever" failure AGENTS.md warns about. And each mode has to depend on
   * *only* what it actually reads: a league-scoped picker that also keyed on
   * the favorites would refetch — and flash a spinner over its own list —
   * every time you starred a row on it.
   */
  const scopeKey = league
    ? `league:${league.id}`
    : wantsEveryLeague
      ? 'all'
      : `follows:${followedLeagueIds.join(',')}`;

  // The followed-leagues path can't name a league until the persisted
  // favorites are in memory, and an un-hydrated store is indistinguishable
  // from following nobody. Tracked as its own flag rather than folded into
  // the key above, so hydration landing re-runs the effect for that path and
  // for no other — an `'all'` picker refetching mid-onboarding because the
  // store finished reading would be a spinner over a list already on screen.
  const awaitingFavorites = !league && !wantsEveryLeague && !hydrated;

  const load = useCallback(async () => {
    // Returning *before* touching `loading` is the point: settling to
    // "loaded, no teams" here would flash every screen's empty state on
    // every cold launch, and `loading` already starts true.
    if (awaitingFavorites) return;

    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = league
        ? await fetchTeams(league)
        : wantsEveryLeague
          ? await fetchAllTeams()
          : await fetchTeamsForLeagues(followedLeagueIds);
      if (id !== requestId.current) return;
      setTeams(result);
    } catch {
      if (id !== requestId.current) return;
      setError('Could not load teams. Check your connection and try again.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
    // Everything read inside is reachable from scopeKey — see its note above
    // for why the descriptors themselves can't be dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, awaitingFavorites]);

  useEffect(() => {
    // Fetch-on-mount: load() sets `loading` synchronously before awaiting.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { teams, loading, error, reload: load };
}
