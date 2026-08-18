import { useEffect, useRef, useState } from 'react';

import { DEFAULT_LEAGUE, getLeague } from '@/lib/league-catalog';
import { focusGame, isInSeason } from '@/lib/program-moves';
import { fetchTeamSchedule, ScheduledGame } from '@/lib/schedule';
import { Team } from '@/lib/teams';

export interface TeamContext {
  team: Team;
  /** The game worth showing, when the season is close enough to matter. */
  game: ScheduledGame | null;
}

/**
 * What's happening with each followed team right now.
 *
 * In season that's the next game. Out of season it's nothing from here —
 * the screen falls back to the team's latest roster or staff move, which
 * it already has from the news pool. A countdown to something seven months
 * away is not a reason to open an app.
 *
 * Schedules are cached (3 min TTL) in schedule.ts, so this is cheap on
 * every mount after the first.
 */
export function useContextStrip(teams: Team[]) {
  const [contexts, setContexts] = useState<TeamContext[]>([]);

  // The same out-of-order guard the other hooks use: following a new team
  // re-runs this, and a slow first response must not land after a fast
  // second one.
  const requestId = useRef(0);
  const key = teams.map((t) => `${t.leagueId}:${t.id}`).join(',');

  useEffect(() => {
    if (teams.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setContexts([]);
      return;
    }

    const id = ++requestId.current;

    Promise.all(
      teams.map(async (team): Promise<TeamContext> => {
        const league = getLeague(team.leagueId) ?? DEFAULT_LEAGUE;
        try {
          const games = await fetchTeamSchedule(team.id, league);
          // Out of season the strip has nothing useful to say about a
          // game, so it says nothing rather than counting down to August.
          return { team, game: isInSeason(games) ? focusGame(games) : null };
        } catch {
          // A failed schedule reads as out of season, which degrades to the
          // offseason presentation rather than a broken countdown.
          return { team, game: null };
        }
      }),
    ).then((next) => {
      if (id === requestId.current) setContexts(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return contexts;
}
