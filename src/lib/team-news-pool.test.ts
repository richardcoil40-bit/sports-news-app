import { describe, expect, it, vi } from 'vitest';

import { getLeague } from '@/lib/league-catalog';
import { fetchTeamNewsPool } from '@/lib/team-news-pool';

const bigTen = getLeague('big-ten')!;

describe('fetchTeamNewsPool', () => {
  /**
   * The guard exists because an empty name is not a weaker filter, it's an
   * absent one: every narrowing step here runs through
   * `wordBoundaryMatch(text, '')`, which is true for any text. So the failure
   * this prevents isn't "no articles", it's a pool of unrelated national news
   * cached under a real team's key — see the note on the function itself.
   *
   * Asserting `fetch` was never called is the half that matters. Rejecting
   * after doing the work would still poison the cache.
   */
  it('rejects an empty team name without fetching anything', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(fetchTeamNewsPool('194', '', bigTen)).rejects.toThrow(/no team name/);
    await expect(fetchTeamNewsPool('194', '   ', bigTen)).rejects.toThrow(/no team name/);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
