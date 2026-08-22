import { afterEach, describe, expect, it, vi } from 'vitest';

import { getLeagues } from '@/lib/league-catalog';
import { fetchAllTeams, fetchTeamsForLeagues } from '@/lib/teams';

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

/**
 * The narrower path, and the one nearly every screen takes. What it exists to
 * prevent is a cold launch opening one standings request per league in the
 * catalog when the user follows teams in one or two of them — a cost that
 * scales with what *exists* rather than with what the user chose, which is
 * the thing the whole catalog-growth effort is trying to keep out of hot
 * paths.
 */
describe('fetchTeamsForLeagues', () => {
  it('asks only for the leagues named', async () => {
    const fetchMock = standingsFor({
      [BIG_TEN_GROUP]: { teams: ['Michigan'] },
      [SEC_GROUP]: { teams: ['Alabama'] },
    });
    vi.stubGlobal('fetch', fetchMock);

    const teams = await fetchTeamsForLeagues(['sec'], { force: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(teams.map((t) => t.shortName)).toEqual(['Alabama']);
  });

  // A first launch, and the one case that must not look like a failure: there
  // is nothing to ask for and nothing wrong.
  it('resolves empty for no leagues without touching the network', async () => {
    const fetchMock = standingsFor({});
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchTeamsForLeagues([], { force: true })).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A favorite can outlive its league — one moved to `planned`, or dropped
  // from the catalog. That is a normal thing to find on a device, not an
  // error, and it can't resolve to a team either way.
  it('ignores an id the catalog does not serve', async () => {
    const fetchMock = standingsFor({ [SEC_GROUP]: { teams: ['Alabama'] } });
    vi.stubGlobal('fetch', fetchMock);

    const teams = await fetchTeamsForLeagues(['sec', 'league-that-left'], { force: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(teams.map((t) => t.shortName)).toEqual(['Alabama']);
  });

  it('still spans the leagues it was given, sorted together', async () => {
    vi.stubGlobal(
      'fetch',
      standingsFor({
        [BIG_TEN_GROUP]: { teams: ['Michigan'] },
        [SEC_GROUP]: { teams: ['Alabama'] },
      }),
    );

    const teams = await fetchTeamsForLeagues(['big-ten', 'sec'], { force: true });

    expect(teams.map((t) => t.shortName)).toEqual(['Alabama', 'Michigan']);
  });

  // Same softening fetchAllTeams makes, for the same reason: one conference
  // being down should cost that conference, not every team you follow.
  it('keeps the leagues that worked when one fails', async () => {
    vi.stubGlobal(
      'fetch',
      standingsFor({
        [BIG_TEN_GROUP]: { ok: false, teams: [] },
        [SEC_GROUP]: { teams: ['Alabama'] },
      }),
    );

    const teams = await fetchTeamsForLeagues(['big-ten', 'sec'], { force: true });

    expect(teams.map((t) => t.shortName)).toEqual(['Alabama']);
  });

  // And the same hard line when nothing resolves. Note this is *not* the
  // empty-input case above: leagues were asked for and none answered, which
  // is the "empty app that looks like it loaded fine" failure.
  it('throws when every named league fails', async () => {
    vi.stubGlobal(
      'fetch',
      standingsFor({
        [BIG_TEN_GROUP]: { ok: false, teams: [] },
        [SEC_GROUP]: { ok: false, teams: [] },
      }),
    );

    await expect(fetchTeamsForLeagues(['big-ten', 'sec'], { force: true })).rejects.toThrow(
      /No league team list/,
    );
  });
});
