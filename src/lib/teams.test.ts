import { afterEach, describe, expect, it, vi } from 'vitest';

import { getLeagues } from '@/lib/league-catalog';
import { fetchAllTeams } from '@/lib/teams';

/**
 * The contract worth protecting here is the one that only exists once
 * there are two leagues: a favorite is stored league-qualified, so the
 * list that resolves favorites has to span every league. And because it
 * spans them, one conference's standings endpoint failing must cost the
 * user that conference rather than every team they follow — which is a
 * deliberate softening of the throw-on-failure rule `fetchTeams` follows
 * for a single league.
 *
 * `force: true` throughout: the team list caches per league at module
 * scope with a 30-minute TTL and no reset hook.
 */

/** ESPN's group filter is the only thing separating one conference's URL. */
function standingsFor(responses: Record<number, { ok?: boolean; teams: string[] }>) {
  return vi.fn(async (url: string) => {
    const group = Number(new URL(url).searchParams.get('group'));
    const response = responses[group];
    if (!response) return { ok: false, status: 404, json: async () => null };

    return {
      ok: response.ok ?? true,
      status: response.ok === false ? 503 : 200,
      json: async () => ({
        standings: {
          entries: response.teams.map((shortName, index) => ({
            team: {
              id: `${group}${index}`,
              displayName: `${shortName} Team`,
              shortDisplayName: shortName,
              abbreviation: shortName.slice(0, 3).toUpperCase(),
            },
          })),
        },
      }),
    };
  });
}

const BIG_TEN_GROUP = 5;
const SEC_GROUP = 8;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchAllTeams', () => {
  it('returns every available league, tagged with the league it came from', async () => {
    vi.stubGlobal(
      'fetch',
      standingsFor({
        [BIG_TEN_GROUP]: { teams: ['Michigan'] },
        [SEC_GROUP]: { teams: ['Alabama'] },
      }),
    );

    const teams = await fetchAllTeams({ force: true });

    expect(teams.map((t) => t.leagueId)).toEqual(expect.arrayContaining(['big-ten', 'sec']));
    expect(teams.find((t) => t.shortName === 'Alabama')?.leagueId).toBe('sec');
    expect(teams.find((t) => t.shortName === 'Michigan')?.leagueId).toBe('big-ten');
  });

  it('sorts across leagues rather than concatenating them', async () => {
    vi.stubGlobal(
      'fetch',
      standingsFor({
        [BIG_TEN_GROUP]: { teams: ['Michigan', 'Zzz'] },
        [SEC_GROUP]: { teams: ['Alabama', 'Ole Miss'] },
      }),
    );

    const teams = await fetchAllTeams({ force: true });

    expect(teams.map((t) => t.shortName)).toEqual(['Alabama', 'Michigan', 'Ole Miss', 'Zzz']);
  });

  it('keeps the leagues that worked when one fails', async () => {
    vi.stubGlobal(
      'fetch',
      standingsFor({
        [BIG_TEN_GROUP]: { ok: false, teams: [] },
        [SEC_GROUP]: { teams: ['Alabama'] },
      }),
    );

    const teams = await fetchAllTeams({ force: true });

    expect(teams.map((t) => t.shortName)).toEqual(['Alabama']);
  });

  // The single-league rule still applies to the whole: an empty list is an
  // empty app that looks like it loaded fine, so it has to surface as a
  // retryable error instead.
  it('throws when no league resolves at all', async () => {
    vi.stubGlobal(
      'fetch',
      standingsFor({
        [BIG_TEN_GROUP]: { ok: false, teams: [] },
        [SEC_GROUP]: { ok: false, teams: [] },
      }),
    );

    await expect(fetchAllTeams({ force: true })).rejects.toThrow(/No league team list/);
  });

  it('covers every league the catalog offers, not a hardcoded pair', async () => {
    const fetchMock = standingsFor({
      [BIG_TEN_GROUP]: { teams: ['Michigan'] },
      [SEC_GROUP]: { teams: ['Alabama'] },
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchAllTeams({ force: true });

    expect(fetchMock).toHaveBeenCalledTimes(getLeagues().length);
  });
});
