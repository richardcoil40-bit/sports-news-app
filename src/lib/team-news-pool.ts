import { createEntityCache } from '@/lib/cache';
import { filterArticlesForTeams } from '@/lib/conference-filter';
import { filterOffTopic } from '@/lib/off-topic';
import { filterOtherSports } from '@/lib/off-sport';
import { Article, fetchFeeds } from '@/lib/feeds';
import { DEFAULT_LEAGUE } from '@/lib/league-catalog';
import { espnCacheKey, League } from '@/lib/leagues';
import { fetchLeagueFeeds, teamSourcesFor } from '@/lib/source-catalog';
import { fetchTeamArticles } from '@/lib/team-news';
import { localNamesFor, schoolNamesFor } from '@/lib/team-nicknames';
import { classifyHeadlines, isRelevantVerdict } from '@/lib/verdicts';

export interface TeamNewsPool {
  articles: Article[];
  failedSources: string[];
}

// Fetching this pool touches every community/local source for a team, not
// just the (already-cached) national feeds — so without its own cache, the
// News tab, the Players tab (which ranks players by mentions in this same
// pool), and every player's detail screen were each re-fetching and
// re-parsing all of it independently. Cached per team for a
// few minutes, with in-flight requests shared so rapid navigation (team →
// player, tab → tab) doesn't fire duplicate fetches of the same sources.
const CACHE_TTL_MS = 3 * 60 * 1000;
const poolCache = createEntityCache<string, TeamNewsPool>({ ttlMs: CACHE_TTL_MS });

// Debug: logs how long the four fetch groups take. Every underlying request
// already has its own 10s timeout, so this pool should never take much more
// than ~10-11s — if reports say it hangs well past that, these logs (plus
// the per-source ones in feeds.ts) show whether one group is the long pole
// or whether it's genuinely stuck (never resolves at all).
const DEBUG_TIMING = false;

// classifyHeadlines has its own internal timeout (see CLASSIFY_TIMEOUT_MS in
// verdicts.ts), but this pool has a tighter budget of its own: it normally
// resolves in ~10-11s against a 15s hard cap (HARD_CAP_MS below), and
// blocking on the full classify timeout every time would risk tripping
// that cap on an otherwise-healthy fetch. So this race is shorter than
// verdicts.ts's own timeout — if the service hasn't answered by then, this
// pool falls through to the unrefined article list rather than wait. The
// classification call itself is not cancelled: it keeps running, and
// whatever it resolves to still lands in verdicts.ts's in-process memo (and
// the worker's own cross-user cache) for the *next* refresh to use.
const VERDICT_RACE_MS = 3000;

async function withVerdictRefinement(articles: Article[], league: League): Promise<Article[]> {
  // Articles with no title can't be classified — the worker rejects a
  // batch containing one rather than silently skipping it (see
  // worker/src/index.ts's parseItems) — and shouldn't be able to invalidate
  // classification for the rest of the batch just by being present.
  const classifiable = articles.filter((a) => a.title?.trim());
  if (classifiable.length === 0) return articles;

  // `link` is already this pool's uniqueness key (see the dedupe step
  // above), so it doubles as the opaque id the verdicts service echoes
  // back — see worker/README.md's note that ids are never seen by the model.
  const classification = classifyHeadlines(classifiable.map((a) => ({ id: a.link, title: a.title })));

  const verdicts = await Promise.race([
    classification,
    new Promise<null>((resolve) => setTimeout(resolve, VERDICT_RACE_MS, null)),
  ]);

  // Timed out before the service (or its own internal timeout) answered —
  // nothing to filter on yet. With EXPO_PUBLIC_VERDICT_URL unset,
  // classifyHeadlines resolves well inside this race with every item
  // mapped to `null`, and isRelevantVerdict(null, ...) keeps everything —
  // so this filter is a no-op in that case, not this early return.
  if (!verdicts) return articles;

  return articles.filter((a) => isRelevantVerdict(verdicts.get(a.link) ?? null, league));
}

async function fetchTeamNewsPoolUncached(
  teamId: string,
  teamShortName: string,
  league: League,
): Promise<TeamNewsPool> {
  const poolStartedAt = Date.now();
  if (DEBUG_TIMING) console.log(`[pool] start for team ${teamId} (${teamShortName})`);

  const sources = teamSourcesFor(league, teamShortName);
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
    timeGroup('espn team news', fetchTeamArticles(teamId, league)),
    timeGroup('community/team sites', teamScoped.length > 0 ? fetchFeeds(teamScoped) : Promise.resolve(empty)),
    timeGroup('local newsroom', broadScoped.length > 0 ? fetchFeeds(broadScoped) : Promise.resolve(empty)),
    timeGroup('national pool', fetchLeagueFeeds(league)),
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
    lists.push(filterArticlesForTeams(espnResult.value, schoolNamesFor(teamShortName)));
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
  //
  // The local paper gets nicknames as well as the school name, and only
  // the local paper does: "Huskers" is unambiguous in the Lincoln Journal
  // Star and "Wildcats" is four different schools in a national feed. See
  // team-nicknames.ts, which is where that restriction is argued.
  if (localResult.status === 'fulfilled') {
    lists.push(filterArticlesForTeams(localResult.value.articles, localNamesFor(teamShortName)));
    failedSources.push(...localResult.value.failedSources);
  } else {
    failedSources.push(...broadScoped.map((s) => s.name));
  }

  if (generalResult.status === 'fulfilled') {
    lists.push(filterArticlesForTeams(generalResult.value.articles, schoolNamesFor(teamShortName)));
    failedSources.push(...generalResult.value.failedSources);
  } else {
    failedSources.push('National college football feeds');
  }

  const seen = new Set<string>();
  const deduped = lists.flat().filter((a) => {
    if (seen.has(a.link)) return false;
    seen.add(a.link);
    return true;
  });

  // Dropped here, alongside the team-name filter above, rather than at
  // render: affiliate copy and campus-governance stories aren't news at
  // all, so nothing downstream should count them either. notable-players.ts
  // ranks by how often a player is named, and a jersey ad naming a star
  // would inflate that.
  //
  // Other sports go at the same point and for the same reason, but they
  // answer a different question — see off-sport.ts. The team-name filter
  // above can't catch them: Nebraska volleyball is unimpeachably about
  // Nebraska, and the team sites this pool takes wholesale cover a whole
  // athletic department, not one football team.
  const localFiltered = filterOtherSports(filterOffTopic(deduped), league);

  // Optional refinement pass — see docs/deferred-work.md and verdicts.ts.
  // With EXPO_PUBLIC_VERDICT_URL unset (the default: no build ships this
  // configured yet), classifyHeadlines resolves immediately with no
  // network call and isRelevantVerdict keeps everything, so this is a
  // no-op for every build that hasn't set up the service.
  const articles = await withVerdictRefinement(localFiltered, league);

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
      const stale = poolCache.peek(teamId);
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
 * Deduped and sorted newest-first. Used as the base for the News and
 * Players tabs, and for each player's detail screen — all pulling from the
 * same cached pool rather than fetching their own.
 */
export async function fetchTeamNewsPool(
  teamId: string,
  teamShortName: string,
  league: League = DEFAULT_LEAGUE,
  options?: { force?: boolean },
): Promise<TeamNewsPool> {
  return poolCache.get(
    espnCacheKey(league, teamId),
    () =>
      withHardCap(teamId, teamShortName, fetchTeamNewsPoolUncached(teamId, teamShortName, league)),
    { force: options?.force },
  );
}
