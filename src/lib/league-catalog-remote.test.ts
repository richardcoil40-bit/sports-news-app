import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import bundledLeagues from '@/lib/__data__/leagues.json';
import {
  DEFAULT_LEAGUE,
  fetchLeagueCatalog,
  getCatalogLeagues,
  getLeague,
  getLeagues,
  refreshLeagueCatalog,
  subscribeToLeagueCatalog,
} from '@/lib/league-catalog';

/**
 * The remote half of the catalog, and the one rule it exists to hold:
 * **nothing here may ever leave the app on an empty league list.**
 *
 * That is `teams.ts`'s rule, for `teams.ts`'s reason — the tab bar, the
 * filters and every per-team fetch key off this list, so `[]` is an empty app
 * that renders as though it loaded fine. It splits across two functions and
 * both halves are tested here:
 *
 * - `fetchLeagueCatalog` **throws** rather than hand back something unusable.
 * - `refreshLeagueCatalog` **catches** and keeps whatever list is in force.
 *
 * Written to be order-independent, because this module holds the installed
 * catalog at module scope with no reset hook (see AGENTS.md's Tests section).
 * The failure-path tests therefore assert against whatever was in force when
 * they started rather than against the bundled list by name, so they hold
 * whether or not an earlier test installed something.
 */

const ORIGINAL_URL = process.env.EXPO_PUBLIC_CATALOG_URL;
const BASE = 'https://catalog.test';

function setUrl(url: string | undefined) {
  if (url === undefined) delete process.env.EXPO_PUBLIC_CATALOG_URL;
  else process.env.EXPO_PUBLIC_CATALOG_URL = url;
}

/** A well-formed entry, to vary one field at a time from. */
const VALID = {
  id: 'acc',
  displayName: 'ACC',
  sport: 'Football',
  level: 'College',
  espnSport: 'football',
  espnLeaguePath: 'college-football',
  espnGroup: 1,
  seasonStartMonth: 8,
};

/** Responds 200 with `body` as the parsed JSON. */
function serving(body: unknown) {
  // The `url` parameter is declared, unused, so the mock's call tuple carries
  // it — two tests read back which URL was asked for.
  const fetchMock = vi.fn(async (_url: string) => ({
    ok: true,
    status: 200,
    json: async () => body,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

let warned: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setUrl(BASE);
  // Spied rather than silenced only: the fallback being *loud* is part of the
  // contract — an app quietly running a months-old bundled list looks exactly
  // like an app that is up to date.
  warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  setUrl(ORIGINAL_URL);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchLeagueCatalog — throws rather than yield an empty list', () => {
  it('on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => [] })));
    await expect(fetchLeagueCatalog(BASE)).rejects.toThrow(/responded 503/);
  });

  it('when the request itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
    );
    await expect(fetchLeagueCatalog(BASE)).rejects.toThrow(/Network request failed/);
  });

  it('on a body that is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      })),
    );
    await expect(fetchLeagueCatalog(BASE)).rejects.toThrow(SyntaxError);
  });

  // Each of these parses fine and yields nothing usable, which is the failure
  // that has to land as a throw rather than as a short list.
  describe('on well-formed JSON with no available league in it', () => {
    const cases: [string, unknown][] = [
      ['an empty array', []],
      ['an object instead of an array', { leagues: [VALID] }],
      ['a bare string', 'nope'],
      ['null', null],
      ['an array of junk', [null, 'x', 3, [], {}]],
      ['an array of entries all missing required fields', [{ id: 'a' }, { displayName: 'B' }]],
      ['a catalog of nothing but planned leagues', [{ ...VALID, status: 'planned' }]],
    ];

    for (const [label, body] of cases) {
      it(label, async () => {
        serving(body);
        await expect(fetchLeagueCatalog(BASE)).rejects.toThrow(/no available leagues/);
      });
    }
  });
});

describe('fetchLeagueCatalog — the success side of that line', () => {
  it('drops invalid entries individually and keeps the rest', async () => {
    serving([
      VALID,
      { id: 'broken' },
      null,
      { ...VALID, id: 'big-12', displayName: 'Big 12', espnGroup: 4 },
      'not an object',
    ]);

    const leagues = await fetchLeagueCatalog(BASE);
    expect(leagues.map((l) => l.id)).toEqual(['acc', 'big-12']);
  });

  // A planned league alongside an available one is a normal catalog, not a
  // broken one — the picker is meant to show what's coming.
  it('keeps planned entries as long as something is available', async () => {
    serving([VALID, { ...VALID, id: 'mls', displayName: 'MLS', status: 'planned' }]);

    const leagues = await fetchLeagueCatalog(BASE);
    expect(leagues.map((l) => l.status)).toEqual([undefined, 'planned']);
  });

  it('asks the Worker for /v1/leagues', async () => {
    const fetchMock = serving([VALID]);
    await fetchLeagueCatalog(BASE);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/v1/leagues`);
  });
});

describe('refreshLeagueCatalog — falls back, never empties', () => {
  /** Whatever list is in force right now, so these hold in any order. */
  function inForce() {
    return { catalog: getCatalogLeagues(), available: getLeagues() };
  }

  it('keeps the current catalog when the fetch fails', async () => {
    const before = inForce();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => [] })));

    await expect(refreshLeagueCatalog({ force: true })).resolves.toBe(false);
    expect(getCatalogLeagues()).toBe(before.catalog);
    expect(getLeagues().length).toBeGreaterThan(0);
    expect(warned).toHaveBeenCalled();
  });

  it('keeps the current catalog when the body is malformed JSON', async () => {
    const before = inForce();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected end of JSON input');
        },
      })),
    );

    await expect(refreshLeagueCatalog({ force: true })).resolves.toBe(false);
    expect(getCatalogLeagues()).toBe(before.catalog);
    expect(getLeagues().length).toBeGreaterThan(0);
    expect(warned).toHaveBeenCalled();
  });

  it('keeps the current catalog when the response holds no usable league', async () => {
    const before = inForce();
    serving([{ id: 'broken' }, null, 7]);

    await expect(refreshLeagueCatalog({ force: true })).resolves.toBe(false);
    expect(getCatalogLeagues()).toBe(before.catalog);
    expect(getLeagues().length).toBeGreaterThan(0);
    expect(warned).toHaveBeenCalled();
  });

  it('never touches the network with no catalog URL set', async () => {
    const before = inForce();
    setUrl(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshLeagueCatalog({ force: true })).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getCatalogLeagues()).toBe(before.catalog);
    // Silence here, unlike the failures above: an unconfigured build running
    // on its bundled catalog is the documented default, not a degradation.
    expect(warned).not.toHaveBeenCalled();
  });

  it('normalizes a trailing slash on the configured base URL', async () => {
    setUrl(`${BASE}//`);
    const fetchMock = serving([VALID]);

    await refreshLeagueCatalog({ force: true });

    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/v1/leagues`);
  });

  it('shares one request between concurrent callers', async () => {
    const fetchMock = serving([VALID]);
    await Promise.all([refreshLeagueCatalog({ force: true }), refreshLeagueCatalog()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('refreshLeagueCatalog — installing a partially-invalid catalog', () => {
  const remote = [
    VALID,
    { id: 'garbage-no-sport', displayName: 'Garbage' },
    { ...VALID, id: 'mls', displayName: 'MLS', sport: 'Soccer', status: 'planned' },
    { ...VALID, espnGroup: 'not a number' },
  ];

  it('installs the readable entries and drops the rest', async () => {
    serving(remote);
    await expect(refreshLeagueCatalog({ force: true })).resolves.toBe(true);

    // The fourth entry duplicates `acc`'s id, so it loses to the first —
    // ids are cache keys, and the malformed group is dropped either way.
    expect(getCatalogLeagues().map((l) => l.id)).toEqual(['acc', 'mls']);
    expect(getLeagues().map((l) => l.id)).toEqual(['acc']);
    expect(getLeagues().length).toBeGreaterThan(0);
  });

  it('resolves a league the bundled catalog has never heard of', async () => {
    serving(remote);
    await refreshLeagueCatalog({ force: true });

    expect(getLeague('acc')?.displayName).toBe('ACC');
    expect(getLeague('mls')?.status).toBe('planned');
  });

  it('memoizes the available list and invalidates it on install', async () => {
    serving([VALID]);
    await refreshLeagueCatalog({ force: true });

    const first = getLeagues();
    expect(getLeagues()).toBe(first);

    serving([VALID, { ...VALID, id: 'big-12', displayName: 'Big 12', espnGroup: 4 }]);
    await refreshLeagueCatalog({ force: true });

    expect(getLeagues()).not.toBe(first);
    expect(getLeagues().map((l) => l.id)).toEqual(['acc', 'big-12']);
  });

  it('notifies subscribers on install and not on a failed refresh', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToLeagueCatalog(listener);

    serving([VALID]);
    await refreshLeagueCatalog({ force: true });
    expect(listener).toHaveBeenCalledTimes(1);

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => [] })));
    await refreshLeagueCatalog({ force: true });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    serving([VALID]);
    await refreshLeagueCatalog({ force: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  /**
   * `DEFAULT_LEAGUE` resolves an *absent* league id — a favorite written
   * before keys were league-qualified, or a deep link that arrived without
   * one. Those are questions about what this build shipped with, so it stays
   * pinned to the bundled catalog rather than following the remote one; a
   * remote reorder silently changing which league a legacy favorite migrates
   * into would be worse, and invisible.
   */
  it('leaves DEFAULT_LEAGUE pinned to the bundled catalog', async () => {
    serving([VALID]);
    await refreshLeagueCatalog({ force: true });

    expect(bundledLeagues.map((l) => l.id)).toContain(DEFAULT_LEAGUE.id);
    expect(DEFAULT_LEAGUE.espnSport).toBeTruthy();
    expect(DEFAULT_LEAGUE.espnLeaguePath).toBeTruthy();
    // And the install really did drop it, so the assertion above is not
    // passing by accident on a catalog that still contains it.
    expect(getLeague(DEFAULT_LEAGUE.id)).toBeNull();
  });
});
