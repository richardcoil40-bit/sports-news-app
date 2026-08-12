import { communitySourcesForTeam } from '@/lib/community-sources';
import { filterArticlesForTeams } from '@/lib/conference-filter';
import { Article, fetchAllFeeds, fetchFeeds } from '@/lib/feeds';
import { fetchTeamArticles } from '@/lib/team-news';

export interface TeamNewsPool {
  articles: Article[];
  failedSources: string[];
}

// Fetching this pool touches every community/local source for a team, not
// just the (already-cached) national feeds — so without its own cache, the
// News tab, the Players tab (which ranks players by mentions in this same
// pool), the Recruiting tab, and every player's detail screen were each
// re-fetching and re-parsing all of it independently. Cached per team for a
// few minutes, with in-flight requests shared so rapid navigation (team →
// player, tab → tab) doesn't fire duplicate fetches of the same sources.
const CACHE_TTL_MS = 3 * 60 * 1000;
const cache = new Map<string, { pool: TeamNewsPool; cachedAt: number }>();
const inFlight = new Map<string, Promise<TeamNewsPool>>();

// Debug: logs how long the four fetch groups take. Every underlying request
// already has its own 10s timeout, so this pool should never take much more
// than ~10-11s — if reports say it hangs well past that, these logs (plus
// the per-source ones in feeds.ts) show whether one group is the long pole
// or whether it's genuinely stuck (never resolves at all).
const DEBUG_TIMING = false;

async function fetchTeamNewsPoolUncached(teamId: string, teamShortName: string): Promise<TeamNewsPool> {
  const poolStartedAt = Date.now();
  if (DEBUG_TIMING) console.log(`[pool] start for team ${teamId} (${teamShortName})`);

  const sources = communitySourcesForTeam(teamShortName);
  const teamScoped = sources.filter((s) => s.scope !== 'broad');
  const broadScoped = sources.filter((s) => s.scope === 'broad');

  const empty = { articles: [] as Article[], failedSources: [] as string[] };

  const timeGroup = <T,>(label: string, p: Promise<T>): Promise<T> => {
    if (!DEBUG_TIMING) return p;
    const startedAt = Date.now();
    return p
      .then((v) => {
        console.log(`[pool] ✓ group "${label}" done in ${Date.now() - startedAt}ms`);
        return v;
      })
      .catch((err) => {
        console.log(`[pool] ✗ group "${label}" failed after ${Date.now() - startedAt}ms: ${err}`);
        throw err;
      });
  };

  const [espnResult, teamSiteResult, localResult, generalResult] = await Promise.allSettled([
    timeGroup('espn team news', fetchTeamArticles(teamId)),
    timeGroup('community/team sites', teamScoped.length > 0 ? fetchFeeds(teamScoped) : Promise.resolve(empty)),
    timeGroup('local newsroom', broadScoped.length > 0 ? fetchFeeds(broadScoped) : Promise.resolve(empty)),
    timeGroup('national pool', fetchAllFeeds()),
  ]);

  if (DEBUG_TIMING) console.log(`[pool] all groups settled after ${Date.now() - poolStartedAt}ms`);

  const failedSources: string[] = [];
  const lists: Article[][] = [];

  // ESPN's team endpoint is only *re-ranked* toward a team, not
  // restricted to it — a chunk of what it returns is general college
  // football filler that happens to be adjacent. Held to the same
  // name-match standard as every other broad source rather than trusted
  // wholesale, both because it's more relevant and because unfiltered it
  // padded the pool enough to crowd out the smaller sources this app
  // exists to surface.
  if (espnResult.status === 'fulfilled') {
    lists.push(filterArticlesForTeams(espnResult.value, [teamShortName]));
  } else {
    failedSources.push('ESPN team news');
  }

  // Team-specific sites publish nothing but this team — take all of it.
  if (teamSiteResult.status === 'fulfilled') {
    lists.push(teamSiteResult.value.articles);
    failedSources.push(...teamSiteResult.value.failedSources);
  } else {
    failedSources.push(...teamScoped.map((s) => s.name));
  }

  // Local sports sections and the national pool cover far more than this
  // team, so they only contribute articles that name it.
  if (localResult.status === 'fulfilled') {
    lists.push(filterArticlesForTeams(localResult.value.articles, [teamShortName]));
    failedSources.push(...localResult.value.failedSources);
  } else {
    failedSources.push(...broadScoped.map((s) => s.name));
  }

  if (generalResult.status === 'fulfilled') {
    lists.push(filterArticlesForTeams(generalResult.value.articles, [teamShortName]));
    failedSources.push(...generalResult.value.failedSources);
  } else {
    failedSources.push('National college football feeds');
  }

  const seen = new Set<string>();
  const articles = lists.flat().filter((a) => {
    if (seen.has(a.link)) return false;
    seen.add(a.link);
    return true;
  });

  articles.sort((a, b) => {
    if (!a.publishedAt) return 1;
    if (!b.publishedAt) return -1;
    return b.publishedAt.localeCompare(a.publishedAt);
  });

  if (DEBUG_TIMING) {
    console.log(
      `[pool] resolved for ${teamShortName} in ${Date.now() - poolStartedAt}ms — ${articles.length} articles, ${failedSources.length} failed sources${failedSources.length ? `: ${failedSources.join(', ')}` : ''}`,
    );
  }

  return { articles, failedSources };
}

// Belt-and-suspenders: every request inside fetchTeamNewsPoolUncached has
// its own 10s timeout, so the function above should never take much more
// than ~10-11s. If it somehow does (a hang somewhere those timeouts don't
// cover), this stops the UI from spinning forever — after 15s it gives up
// and returns whatever's cached from last time (or empty on a first-ever
// load), rather than leaving the caller waiting indefinitely.
const HARD_CAP_MS = 15000;

function withHardCap(teamId: string, teamShortName: string, work: Promise<TeamNewsPool>): Promise<TeamNewsPool> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const stale = cache.get(teamId)?.pool;
      console.log(
        `[pool] ⚠ hard cap hit for ${teamShortName} after ${HARD_CAP_MS}ms — one of the fetches never resolved despite its own timeout. Falling back to ${stale ? 'stale cached' : 'empty'} data.`,
      );
      resolve(stale ?? { articles: [], failedSources: ['Timed out'] });
    }, HARD_CAP_MS);

    work.then(
      (pool) => {
        clearTimeout(timer);
        resolve(pool);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Everything the app can find that's plausibly about one team: ESPN's
 * team-scoped news, that team's own community and independent sites, its
 * local newsroom's sports section, and the national pool — the last two
 * narrowed to articles that actually name the team, since a metro sports
 * feed also carries pro teams and other sports.
 *
 * Deduped and sorted newest-first. Used as the base for the News, Players,
 * and Recruiting tabs, and for each player's detail screen — all pulling
 * from the same cached pool rather than fetching their own.
 */
export async function fetchTeamNewsPool(
  teamId: string,
  teamShortName: string,
  options?: { force?: boolean },
): Promise<TeamNewsPool> {
  if (!options?.force) {
    const cached = cache.get(teamId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.pool;

    const existing = inFlight.get(teamId);
    if (existing) return existing;
  }

  const promise = withHardCap(teamId, teamShortName, fetchTeamNewsPoolUncached(teamId, teamShortName))
    .then((pool) => {
      cache.set(teamId, { pool, cachedAt: Date.now() });
      return pool;
    })
    .finally(() => {
      inFlight.delete(teamId);
    });

  inFlight.set(teamId, promise);
  return promise;
}
