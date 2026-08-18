import { createEntityCache } from '@/lib/cache';
import { communitySourcesForTeam } from '@/lib/community-sources';
import { FeedSource, FetchAllResult, fetchFeeds } from '@/lib/feeds';
import { getLeagues } from '@/lib/league-catalog';
import { League } from '@/lib/leagues';

/**
 * Which curated sources belong to which league.
 *
 * Curated sources are **optional per league**, and that is the point. Every
 * URL in `community-sources.ts` was verified by hand, so the real cost of a
 * second conference is research, not code — a league with no entry here is
 * not broken, it just runs on ESPN's own team feed until someone does that
 * research. Nothing may assume a league has curated sources.
 *
 * This also breaks a dependency that would otherwise be circular. `feeds.ts`
 * is *how* to fetch a feed; this file is *which* feeds exist. Keeping the
 * source lists here means feeds.ts holds no data and needs no knowledge of
 * leagues at all.
 */

/**
 * The national pool — sources that cover a whole sport rather than any one
 * team. Off Tackle Empire (conference-wide) and Extra Points (the business
 * of college sports) are both wider than a single program, so they count as
 * national even though neither is a big TV network.
 */
const BIG_TEN_NATIONAL_FEEDS: FeedSource[] = [
  { id: 'espn-cfb', name: 'ESPN', url: 'https://www.espn.com/espn/rss/ncf/news', tier: 1, scope: 'broad', reach: 'national' },
  { id: 'cbs-cfb', name: 'CBS Sports', url: 'https://www.cbssports.com/rss/headlines/college-football/', tier: 1, scope: 'broad', reach: 'national' },
  { id: 'yahoo-cfb', name: 'Yahoo Sports', url: 'https://sports.yahoo.com/college-football/rss.xml', tier: 1, scope: 'broad', reach: 'national' },
  { id: 'off-tackle-empire', name: 'Off Tackle Empire', url: 'https://www.offtackleempire.com/rss/index.xml', tier: 3, scope: 'broad', reach: 'national' },
  { id: 'extra-points', name: 'Extra Points', url: 'https://extrapoints.substack.com/feed', tier: 2, scope: 'broad', reach: 'national' },
];

interface LeagueSources {
  /** Feeds covering the whole sport, fetched once and shared across teams. */
  nationalFeeds?: FeedSource[];
  /**
   * Per-team sources, resolved by the team's short name. A function rather
   * than a table so each league keeps its own naming quirks — the Big Ten
   * table is keyed by slug with aliases for ESPN's short names, and another
   * league has no reason to be shaped the same way.
   */
  teamSources?: (teamShortName: string) => FeedSource[];
}

const CATALOG: Record<string, LeagueSources> = {
  'big-ten': {
    nationalFeeds: BIG_TEN_NATIONAL_FEEDS,
    teamSources: communitySourcesForTeam,
  },
};

export function nationalFeedsFor(league: League): FeedSource[] {
  return CATALOG[league.id]?.nationalFeeds ?? [];
}

export function teamSourcesFor(league: League, teamShortName: string): FeedSource[] {
  return CATALOG[league.id]?.teamSources?.(teamShortName) ?? [];
}

/**
 * A league's national pool gets re-requested by a lot of screens — team
 * news, recruiting, and every player detail page all pull from it. Without
 * caching, tapping from team → player re-fetched and re-parsed every feed
 * from scratch, which was most of what made navigation feel slow.
 *
 * Keyed per league rather than a single global result, so two leagues don't
 * serve each other's national coverage.
 */
const CACHE_TTL_MS = 3 * 60 * 1000;
const nationalPoolCache = createEntityCache<string, FetchAllResult>({ ttlMs: CACHE_TTL_MS });

const EMPTY_RESULT: FetchAllResult = { articles: [], failedSources: [] };

export async function fetchLeagueFeeds(
  league: League,
  options?: { force?: boolean },
): Promise<FetchAllResult> {
  const sources = nationalFeedsFor(league);
  // Not cached, because there is nothing to cache and no request to share.
  // A league with no curated feeds is a normal state, not a failure.
  if (sources.length === 0) return EMPTY_RESULT;

  return nationalPoolCache.get(league.id, () => fetchFeeds(sources), { force: options?.force });
}

/**
 * Every league that actually has a national pool. Used by the periodic
 * refresh, which has no single league to speak of — it just wants whatever
 * shared pools exist to be fresh before the user looks at anything.
 */
export function leaguesWithNationalFeeds(): League[] {
  return getLeagues().filter((league) => nationalFeedsFor(league).length > 0);
}
