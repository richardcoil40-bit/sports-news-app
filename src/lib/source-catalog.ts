import { createEntityCache } from '@/lib/cache';
import { big12SourcesForTeam, bigTenSourcesForTeam, secSourcesForTeam } from '@/lib/community-sources';
import { Article, dedupeAndSort, FeedSource, FetchAllResult, fetchFeeds } from '@/lib/feeds';
import { getLeagues } from '@/lib/league-catalog';
import { League } from '@/lib/leagues';
import { fetchLeagueArticles } from '@/lib/team-news';

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
 * team. Extra Points (the business of college sports) is wider than a
 * single program, so it counts as national even though it isn't a big TV
 * network.
 *
 * Every conference in a sport shares these. They're one array rather than
 * copied per league so a URL fix lands everywhere at once — and so the
 * conference-wide blog below stays visibly the only part that differs.
 *
 * ESPN leads the pool but is not in this list: it arrives through the
 * `espnLeagueNews` flag below, via its JSON news API rather than RSS.
 * (Its RSS entry lived here until 2026-08-25 — see the flag's comment.)
 */
const NATIONAL_CFB_FEEDS: FeedSource[] = [
  { id: 'cbs-cfb', name: 'CBS Sports', url: 'https://www.cbssports.com/rss/headlines/college-football/', tier: 1, scope: 'broad', reach: 'national' },
  { id: 'yahoo-cfb', name: 'Yahoo Sports', url: 'https://sports.yahoo.com/college-football/rss.xml', tier: 1, scope: 'broad', reach: 'national' },
  { id: 'extra-points', name: 'Extra Points', url: 'https://extrapoints.substack.com/feed', tier: 2, scope: 'broad', reach: 'national' },
];

/**
 * A conference-wide blog counts as national by the same argument: it is
 * wider than any one program, so it gets name-filtered down to the team
 * like the rest of the pool rather than taken whole.
 *
 * The SEC's equivalent of Off Tackle Empire would have been SB Nation's
 * Team Speed Kills, which Vox shut down — see community-sources.ts.
 * Saturday Down South is the independent that covers that ground.
 */
const OFF_TACKLE_EMPIRE: FeedSource = { id: 'off-tackle-empire', name: 'Off Tackle Empire', url: 'https://www.offtackleempire.com/rss/index.xml', tier: 3, scope: 'broad', reach: 'national' };
const SATURDAY_DOWN_SOUTH: FeedSource = { id: 'saturday-down-south', name: 'Saturday Down South', url: 'https://www.saturdaydownsouth.com/feed/', tier: 3, scope: 'broad', reach: 'national' };

/**
 * The NFL's pool. Not the list above with a different path, and not a copy
 * of it either — the two lists share no URL, because every one of these
 * publishers splits college and pro into separate feeds.
 *
 * ESPN arrives via `espnLeagueNews` rather than this list. Its RSS path
 * (`espn.com/espn/rss/nfl/news`) answers 202 with an empty body — the
 * failure feeds.ts was taught to report rather than mistake for a quiet
 * day — so an RSS entry here would report a dead source on most fetches.
 * The college equivalent did exactly that from every report in
 * docs/evidence/ since 2026-08-11 until it was removed on 2026-08-25;
 * the write-up is the addendum in docs/evidence/README.md.
 *
 * ProFootballTalk stands where Extra Points does for the college list — a
 * vertical wider than any one team — except that it is NBC Sports' own
 * newsroom rather than an independent, so it is tier 1 on the criteria in
 * docs/source-reliability.md rather than tier 2.
 *
 * There is no per-team table for the NFL yet, and that is a normal state:
 * teamSourcesFor answers `[]`, the pool runs on ESPN's team feed plus
 * these, and curated local papers are backfilled by the same worksheet
 * every other league goes through.
 */
const NATIONAL_NFL_FEEDS: FeedSource[] = [
  { id: 'cbs-nfl', name: 'CBS Sports', url: 'https://www.cbssports.com/rss/headlines/nfl/', tier: 1, scope: 'broad', reach: 'national' },
  { id: 'yahoo-nfl', name: 'Yahoo Sports', url: 'https://sports.yahoo.com/nfl/rss.xml', tier: 1, scope: 'broad', reach: 'national' },
  { id: 'pro-football-talk', name: 'ProFootballTalk', url: 'https://profootballtalk.nbcsports.com/feed/', tier: 1, scope: 'broad', reach: 'national' },
];

interface LeagueSources {
  /** Feeds covering the whole sport, fetched once and shared across teams. */
  nationalFeeds?: FeedSource[];
  /**
   * Per-team sources, resolved by the team's short name. A function rather
   * than a table so each league keeps its own naming quirks — the two
   * conference tables in community-sources.ts are keyed by slug with
   * aliases for ESPN's short names, and a league that isn't a conference
   * of schools has no reason to be shaped the same way.
   */
  teamSources?: (teamShortName: string) => FeedSource[];
  /**
   * Merge ESPN's league-wide JSON news (team-news.ts) into the national
   * pool. A flag rather than a FeedSource entry because the endpoint
   * isn't RSS: keeping it out of `nationalFeeds` keeps that list all-RSS
   * — which is what check-feeds.sh probes — and routes the fetch through
   * the parser team-news.ts already runs per team. The CFB conferences
   * share one underlying URL and each cache its own copy per league id;
   * accepted, since the RSS entry they shared had the same property.
   *
   * A present key is a decision: a new league opts in here after the
   * endpoint is verified for its sport, it doesn't inherit ESPN for free.
   */
  espnLeagueNews?: boolean;
}

const CATALOG: Record<string, LeagueSources> = {
  'big-ten': {
    nationalFeeds: [...NATIONAL_CFB_FEEDS, OFF_TACKLE_EMPIRE],
    teamSources: bigTenSourcesForTeam,
    espnLeagueNews: true,
  },
  'sec': {
    nationalFeeds: [...NATIONAL_CFB_FEEDS, SATURDAY_DOWN_SOUTH],
    teamSources: secSourcesForTeam,
    espnLeagueNews: true,
  },
  // No conference-wide blog: SB Nation's Big 12 equivalent went the way of
  // Team Speed Kills, and nothing independent covers the conference the way
  // Saturday Down South covers the SEC. The national three plus ESPN's
  // league news carry it.
  'big-12': {
    nationalFeeds: NATIONAL_CFB_FEEDS,
    teamSources: big12SourcesForTeam,
    espnLeagueNews: true,
  },
  // No teamSources: see NATIONAL_NFL_FEEDS. A league with no per-team table
  // is the graceful path, not a gap to fill before shipping.
  'nfl': { nationalFeeds: NATIONAL_NFL_FEEDS, espnLeagueNews: true },
};

export function nationalFeedsFor(league: League): FeedSource[] {
  return CATALOG[league.id]?.nationalFeeds ?? [];
}

export function teamSourcesFor(league: League, teamShortName: string): FeedSource[] {
  return CATALOG[league.id]?.teamSources?.(teamShortName) ?? [];
}

export function espnLeagueNewsFor(league: League): boolean {
  return CATALOG[league.id]?.espnLeagueNews ?? false;
}

/**
 * A league's national pool gets re-requested by a lot of screens — team
 * news and every player detail page both pull from it. Without
 * caching, tapping from team → player re-fetched and re-parsed every feed
 * from scratch, which was most of what made navigation feel slow.
 *
 * Keyed per league rather than a single global result, so two leagues don't
 * serve each other's national coverage.
 */
const CACHE_TTL_MS = 3 * 60 * 1000;
// Keyed per league, so the catalog already bounds this. The explicit cap is
// a backstop for a catalog served from the network rather than bundled,
// where the number of leagues stops being something this repo controls.
const nationalPoolCache = createEntityCache<string, FetchAllResult>({ ttlMs: CACHE_TTL_MS, maxEntries: 50 });

const EMPTY_RESULT: FetchAllResult = { articles: [], failedSources: [] };

/**
 * The two halves of a league's national pool: the curated RSS list and
 * ESPN's league-wide JSON news. A fixed two-wide heterogeneous fan-out,
 * so — like team-news-pool.ts's four source groups — it stays on
 * Promise.allSettled rather than mapWithConcurrency: two is not a number
 * that grows, and the sockets come from fetchFeeds' own expansion, which
 * is already bounded.
 */
async function fetchNationalPool(
  league: League,
  sources: FeedSource[],
  includeEspn: boolean,
): Promise<FetchAllResult> {
  const [rss, espn] = await Promise.allSettled([
    fetchFeeds(sources),
    includeEspn ? fetchLeagueArticles(league) : Promise.resolve<Article[]>([]),
  ]);

  const articleLists: Article[][] = [];
  const failedSources: string[] = [];

  // fetchFeeds is total — it settles per source and always resolves — so
  // the rejected branch is defensive rather than expected.
  if (rss.status === 'fulfilled') {
    articleLists.push(rss.value.articles);
    failedSources.push(...rss.value.failedSources);
  } else {
    failedSources.push(...sources.map((s) => s.name));
  }

  if (espn.status === 'fulfilled') articleLists.push(espn.value);
  // The name the retired RSS entry reported under, so a failed fetch
  // surfaces downstream exactly as it always did.
  else failedSources.push('ESPN');

  return { articles: dedupeAndSort(articleLists), failedSources };
}

export async function fetchLeagueFeeds(
  league: League,
  options?: { force?: boolean },
): Promise<FetchAllResult> {
  const sources = nationalFeedsFor(league);
  const includeEspn = espnLeagueNewsFor(league);
  // Not cached, because there is nothing to cache and no request to share.
  // A league with neither curated feeds nor ESPN's league news is a
  // normal state, not a failure.
  if (sources.length === 0 && !includeEspn) return EMPTY_RESULT;

  return nationalPoolCache.get(league.id, () => fetchNationalPool(league, sources, includeEspn), {
    force: options?.force,
  });
}

/**
 * Every league that actually has a national pool — curated RSS, ESPN's
 * league news, or both. Used by the periodic refresh, which has no single
 * league to speak of — it just wants whatever shared pools exist to be
 * fresh before the user looks at anything.
 */
export function leaguesWithNationalFeeds(): League[] {
  return getLeagues().filter(
    (league) => nationalFeedsFor(league).length > 0 || espnLeagueNewsFor(league),
  );
}
