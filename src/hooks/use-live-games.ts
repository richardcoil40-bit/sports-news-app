import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

import { favoriteKey, leagueIdsFrom } from '@/lib/favorite-keys';
import { inTickerWindow } from '@/lib/game';
import { DEFAULT_CONCURRENCY, mapWithConcurrency } from '@/lib/http';
import { getLeagues } from '@/lib/league-catalog';
import { fetchScoreboard, FollowedGame, followedGames, LiveGame } from '@/lib/scoreboard';
import { Team } from '@/lib/teams';

/** How often a board is re-read while a followed game is in progress. */
export const LIVE_POLL_MS = 30 * 1000;
/** After kickoff, how long to wait before asking whether the game has started. */
const KICKOFF_GRACE_MS = 90 * 1000;
/**
 * The longest a single wait for kickoff is allowed to be. A game six hours
 * out still gets re-read now and then, which is what catches a kickoff ESPN
 * moved — and a 6-hour `setTimeout` is not a timer anyone should trust.
 */
const MAX_WAIT_MS = 15 * 60 * 1000;

/**
 * Games involving a team you follow, for the home screen's ticker, kept
 * current while one is being played.
 *
 * Called once, from the home screen, with the `followedTeams` `useFeed`
 * already resolved — the one-instance rule from AGENTS.md. The game screen
 * doesn't call it; it reads the board this leaves in the scoreboard cache.
 *
 * What it costs is the thing to hold onto:
 *
 * - **One request per followed league**, not per team and never per
 *   catalog league. Scope comes off the favorite keys, like `useTeams()`.
 * - **Polling only while a followed game is in progress *and* the app is in
 *   the foreground.** Backgrounding clears every timer; coming back does one
 *   fetch (from cache if it's fresh) and decides again. Nothing here runs
 *   while the app isn't on screen, which is the posture
 *   `refresh-schedule.ts` already documents for news.
 * - **Before kickoff, one timer** for shortly after the earliest kickoff, so
 *   a pre-game row flips to live without the reader leaving the app.
 *
 * A league whose board fails keeps its last good board rather than dropping
 * its games: a missing ticker row mid-game is the degraded state, and a
 * flicker on every failed poll would be worse than a row thirty seconds old.
 */
export function useLiveGames(followedTeams: readonly Team[]): { games: FollowedGame[]; checkedAt: number } {
  const [games, setGames] = useState<FollowedGame[]>([]);
  // The moment `games` was computed — the ticker formats "today" and the
  // kickoff time against it rather than reading the clock during render.
  const [checkedAt, setCheckedAt] = useState(0);

  // Keys and their join are the primitive the effect depends on; the team
  // objects are a new array whenever the feed re-renders.
  const keys = useMemo(() => followedTeams.map((t) => favoriteKey(t.leagueId, t.id)), [followedTeams]);
  const followedKey = keys.join(',');

  const lastBoards = useRef(new Map<string, LiveGame[]>());

  useEffect(() => {
    const followed = followedKey ? followedKey.split(',') : [];
    const wanted = new Set(leagueIdsFrom(followed));
    const leagues = getLeagues().filter((league) => wanted.has(league.id));

    let timer: ReturnType<typeof setTimeout> | null = null;
    let appState: AppStateStatus = AppState.currentState;
    // Two guards, for two different failures. `latest` stops a slow poll
    // overwriting a faster foreground refresh inside this effect; `disposed`
    // stops anything landing after a follow change has replaced the effect.
    // Neither gates a loading flag, so the tab-change trap in AGENTS.md
    // doesn't apply — there is no spinner here to strand.
    let latest = 0;
    let disposed = false;

    const clear = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    const schedule = (current: FollowedGame[]) => {
      clear();
      if (appState !== 'active') return;
      if (current.some((g) => g.state === 'in')) {
        timer = setTimeout(() => refresh(true), LIVE_POLL_MS);
        return;
      }
      const kickoffs = current
        .filter((g) => g.state === 'pre')
        .map((g) => Date.parse(g.startDate))
        .filter((t) => !Number.isNaN(t));
      if (kickoffs.length === 0) return;
      const wait = Math.min(Math.max(Math.min(...kickoffs) + KICKOFF_GRACE_MS - Date.now(), LIVE_POLL_MS), MAX_WAIT_MS);
      timer = setTimeout(() => refresh(true), wait);
    };

    async function refresh(force: boolean) {
      const id = ++latest;
      if (leagues.length === 0) {
        setGames([]);
        return;
      }

      const results = await mapWithConcurrency(leagues, DEFAULT_CONCURRENCY, (league) =>
        fetchScoreboard(league, { force }),
      );
      if (disposed || id !== latest) return;

      const boards = leagues.map((league, i) => {
        const result = results[i];
        if (result.status === 'fulfilled') {
          lastBoards.current.set(league.id, result.value);
          return { league, games: result.value };
        }
        return { league, games: lastBoards.current.get(league.id) ?? [] };
      });

      const now = Date.now();
      const next = followedGames(boards, followed).filter((g) => inTickerWindow(g, now));
      setGames(next);
      setCheckedAt(now);
      schedule(next);
    }

    // Fetch-on-mount, and on every change to who you follow.
    refresh(false);

    const subscription = AppState.addEventListener('change', (next) => {
      const wasActive = appState === 'active';
      appState = next;
      if (next === 'active' && !wasActive) {
        // Plain read: within thirty seconds of the last fetch this is the
        // cache, so flicking back to the app costs nothing.
        refresh(false);
      } else if (next !== 'active') {
        clear();
      }
    });

    return () => {
      disposed = true;
      clear();
      subscription.remove();
    };
  }, [followedKey]);

  return { games, checkedAt };
}
