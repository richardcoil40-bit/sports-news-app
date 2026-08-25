import { createEntityCache } from '@/lib/cache';
import { filterArticlesForTeams } from '@/lib/conference-filter';
import { recordNicknameRescue, recordVerdictDisagreement, recordYield } from '@/lib/diagnostics';
import { filterOffTopic } from '@/lib/off-topic';
import { filterOtherSports } from '@/lib/off-sport';
import { Article, fetchFeeds } from '@/lib/feeds';
import { espnCacheKey, League } from '@/lib/leagues';
import { fetchLeagueFeeds, teamSourcesFor } from '@/lib/source-catalog';
import { fetchTeamArticles } from '@/lib/team-news';
import { localNamesFor, schoolNamesFor, teamNicknamesFor } from '@/lib/team-nicknames';
import { wordBoundaryMatch } from '@/lib/text-match';
import { classifyHeadlines, isRelevantVerdict } from '@/lib/verdicts';

/**
 * How covered a team actually is, distinct from how many articles came
 * back. A team with zero curated sources used to resolve fulfilled-and-
 * empty with zero failures — indistinguishable from "sources published
 * nothing" and from "everything was filtered out". This is the difference,
 * so an empty screen can say which of those is true. Counts curated
 * per-team sources only; ESPN's team feed and the national pool run for
 * every team and say nothing about this one's coverage.
 */
export interface TeamNewsCoverage {
  /** Curated sources configured for this team. */
  configured: number;
  /** How many of them landed at least one article in this pool. */
  contributed: number;
}

export interface TeamNewsPool {
  articles: Article[];
  failedSources: string[];
  coverage: TeamNewsCoverage;
}

// Fetching this pool touches every community/local source for a team, not
// just the (already-cached) national feeds — so without its own cache, the
// News tab, the Players tab (which ranks players by mentions in this same
// pool), and every player's detail screen were each re-fetching and
// re-parsing all of it independently. Cached per team for a
// few minutes, with in-flight requests shared so rapid navigation (team →
// player, tab → tab) doesn't fire duplicate fetches of the same sources.
const CACHE_TTL_MS = 3 * 60 * 1000;
// Bounded as well as timed: the TTL marks an entry stale but never reclaims
// it — that residency is exactly what the hard-cap fallback's peek() reads —
// so without a size bound a long session accumulates a full article pool per
// team ever opened.
const poolCache = createEntityCache<string, TeamNewsPool>({ ttlMs: CACHE_TTL_MS, maxEntries: 50 });

// League-qualified on purpose, unlike the roster/color/schedule caches that
// key on espnCacheKey alone. Those hold league-independent ESPN entity data,
// so two conferences sharing football/college-football should share entries
// (see leagues.ts). This pool's *composition* is a function of league id —
// source-catalog.ts picks the source tables by league.id — so the shared key
// would let a pool built under one league's sources be served to another.
// Exported because article-store.ts keys its persisted copy of a pool the
// same way — one definition, so the two can never disagree about identity.
export function poolCacheKey(league: League, teamId: string): string {
  return `${league.id}:${espnCacheKey(league, teamId)}`;
}

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

/**
 * Sample rate and cap for the false-negative half of verdict disagreement
 * (diagnostics.ts): classifying a slice of the articles the local-newsroom
 * filter *rejected*, to see if the model thinks one actually names the
 * team — a nickname the table is missing, or a school-name match that was
 * too strict. This is the one mechanism in this file that costs an extra
 * classify call beyond what the pool already makes (see
 * withVerdictRefinement below, which piggybacks on a call it makes
 * anyway) — dev builds only, gated at the one call site in
 * fetchTeamNewsPoolUncached.
 */
const FALSE_NEGATIVE_SAMPLE_RATE = 0.1;
const FALSE_NEGATIVE_SAMPLE_MAX = 5;

/**
 * Fire-and-forget: not awaited by its caller, and doesn't touch the
 * pool's own timing (HARD_CAP_MS) or its returned value. A failed or slow
 * sample just means no diagnostics data for this fetch, not a broken pool.
 * Not a statistical sample — the first N rejects is enough for a dev
 * signal, and keeps a run reproducible while poking at it.
 */
function sampleRejectsForFalseNegatives(teamShortName: string, rejected: Article[]): void {
  const classifiable = rejected.filter((a) => a.title?.trim());
  if (classifiable.length === 0) return;

  const sampleSize = Math.min(FALSE_NEGATIVE_SAMPLE_MAX, Math.ceil(classifiable.length * FALSE_NEGATIVE_SAMPLE_RATE));
  if (sampleSize === 0) return;
  const sample = classifiable.slice(0, sampleSize);

  classifyHeadlines(sample.map((a) => ({ id: a.link, title: a.title })))
    .then((verdicts) => {
      for (const article of sample) {
        recordVerdictDisagreement(
          teamShortName,
          // The reject sample isn't scoped to a single nickname the way a
          // rescue is — it's whatever the local filter as a whole turned
          // down — so there's no one word to credit or blame. "the local
          // filter" names the mechanism plainly rather than picking one.
          'the local filter',
          article,
          verdicts.get(article.link) ?? null,
          'false-negative-candidate',
        );
      }
    })
    .catch(() => {
      // Best-effort dev signal — see the function comment above.
    });
}

async function withVerdictRefinement(
  articles: Article[],
  league: League,
  teamShortName: string,
  nicknameRescuedByLink: Map<string, string>,
): Promise<Article[]> {
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

  // Diagnostics: the false-positive half of verdict disagreement
  // (diagnostics.ts). This is the classify call the pool was already
  // making for filtering — checking a nickname-rescued article's team
  // against the same verdict costs nothing extra, unlike the
  // false-negative sampling above.
  if (nicknameRescuedByLink.size > 0) {
    for (const article of classifiable) {
      const nickname = nicknameRescuedByLink.get(article.link);
      if (nickname) {
        recordVerdictDisagreement(
          teamShortName,
          nickname,
          article,
          verdicts.get(article.link) ?? null,
          'false-positive-candidate',
        );
      }
    }
  }

  return articles.filter((a) => isRelevantVerdict(verdicts.get(a.link) ?? null, league));
}

/**
 * Diagnostics only: of the articles the local-newsroom filter just kept
 * (already matched against `localNamesFor`, school name plus nicknames),
 * which ones matched on a nickname with the school name itself absent —
 * the case a nickname table exists to catch, and the same case a
 * word-for-word disagreement with the classifier ("Wildcats" hazard)
 * matters most for. Records each into diagnostics.ts's per-nickname
 * usefulness count as a side effect, and returns the link → nickname map
 * `withVerdictRefinement` needs to run the classifier cross-check on
 * exactly these articles.
 */
function trackNicknameRescues(teamShortName: string, keptArticles: Article[]): Map<string, string> {
  const rescuedByLink = new Map<string, string>();
  const nicknames = teamNicknamesFor(teamShortName);
  if (nicknames.length === 0) return rescuedByLink;

  const schoolNames = schoolNamesFor(teamShortName);
  for (const article of keptArticles) {
    const text = `${article.title} ${article.description}`;
    if (schoolNames.some((name) => wordBoundaryMatch(text, name))) continue;

    const nickname = nicknames.find((n) => wordBoundaryMatch(text, n));
    if (nickname) {
      recordNicknameRescue(teamShortName, nickname);
      rescuedByLink.set(article.link, nickname);
    }
  }
  return rescuedByLink;
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

  // Deliberately *not* routed through mapWithConcurrency, unlike the other
  // fan-outs in this directory. This one is a fixed four groups rather than
  // a list that grows with the catalog, and its width is not where the
  // sockets come from — each group's own expansion is, and fetchFeeds
  // already bounds that. Limiting here to fewer than four would serialize
  // whole groups against a pool that already runs ~10-11s against the 15s
  // hard cap below, so it would trade a bound it doesn't need for a cap it
  // can't afford to trip.
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
    const filtered = filterArticlesForTeams(espnResult.value, schoolNamesFor(teamShortName));
    recordYield('espn team news', teamShortName, espnResult.value.length, filtered.length);
    lists.push(filtered);
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
  let nicknameRescuedByLink = new Map<string, string>();
  if (localResult.status === 'fulfilled') {
    const filtered = filterArticlesForTeams(localResult.value.articles, localNamesFor(teamShortName));
    recordYield('local newsroom', teamShortName, localResult.value.articles.length, filtered.length);

    // Diagnostics: mechanism 3 (per-nickname usefulness) is pure
    // arithmetic on names already matched above, so it runs unconditionally.
    // The extra classify call it sets up for (mechanism 1's false-positive
    // half) is free too — see withVerdictRefinement — but the false-negative
    // sample just below is not, so that one stays __DEV__-gated.
    nicknameRescuedByLink = trackNicknameRescues(teamShortName, filtered);
    if (__DEV__) {
      const keptLinks = new Set(filtered.map((a) => a.link));
      const rejected = localResult.value.articles.filter((a) => !keptLinks.has(a.link));
      sampleRejectsForFalseNegatives(teamShortName, rejected);
    }

    lists.push(filtered);
    failedSources.push(...localResult.value.failedSources);
  } else {
    failedSources.push(...broadScoped.map((s) => s.name));
  }

  if (generalResult.status === 'fulfilled') {
    const filtered = filterArticlesForTeams(generalResult.value.articles, schoolNamesFor(teamShortName));
    recordYield('national pool', teamShortName, generalResult.value.articles.length, filtered.length);
    lists.push(filtered);
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
  const articles = await withVerdictRefinement(localFiltered, league, teamShortName, nicknameRescuedByLink);

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

  // Counted off the final list rather than per group, so a source whose
  // every item was filtered out (another sport, off-topic, not this team)
  // counts as not contributing — which is the honest answer, and exactly
  // the state a dead-but-answering source sits in.
  const configuredNames = new Set(sources.map((s) => s.name));
  const contributed = new Set(
    articles.filter((a) => configuredNames.has(a.source)).map((a) => a.source),
  ).size;

  return {
    articles,
    failedSources,
    coverage: { configured: sources.length, contributed },
  };
}

// Belt-and-suspenders: every request inside fetchTeamNewsPoolUncached has
// its own 10s timeout, so the function above should never take much more
// than ~10-11s. If it somehow does (a hang somewhere those timeouts don't
// cover), this stops the UI from spinning forever — after 15s it gives up
// and returns whatever's cached from last time (or empty on a first-ever
// load), rather than leaving the caller waiting indefinitely.
const HARD_CAP_MS = 15000;

function withHardCap(
  teamId: string,
  teamShortName: string,
  league: League,
  work: Promise<TeamNewsPool>,
): Promise<TeamNewsPool> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // The same key the pool is written under below — `league` is threaded
      // in for this one line. Peeking on the bare team id silently missed
      // every time, so this fallback could only ever return empty.
      const stale = poolCache.peek(poolCacheKey(league, teamId));
      // warn, not log: unlike the DEBUG_TIMING lines above, this one is
      // always on, because reaching it means a fetch outlived its own
      // timeout — a real anomaly worth seeing without flipping a flag.
      console.warn(
        `[pool] ⚠ hard cap hit for ${teamShortName} after ${HARD_CAP_MS}ms — one of the fetches never resolved despite its own timeout. Falling back to ${stale ? 'stale cached' : 'empty'} data.`,
      );
      resolve(
        stale ?? {
          articles: [],
          failedSources: ['Timed out'],
          coverage: { configured: teamSourcesFor(league, teamShortName).length, contributed: 0 },
        },
      );
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
 *
 * **Rejects on an empty `teamShortName` rather than fetching.** Every filter
 * below narrows a broad feed to the articles naming this team, and
 * `wordBoundaryMatch(text, '')` is `true` — so a nameless call doesn't return
 * less, it returns *everything*, and then stores that under this team's own
 * cache key for the TTL. The next legitimate caller reads back a pool of
 * unrelated national news that looks perfectly healthy. Throwing keeps it
 * uncached (see cache.ts) so the screen shows a retryable error, which is why
 * this doesn't degrade to empty the way the sources themselves do.
 */
export async function fetchTeamNewsPool(
  teamId: string,
  teamShortName: string,
  league: League,
  options?: { force?: boolean },
): Promise<TeamNewsPool> {
  if (!teamShortName.trim()) {
    throw new Error(`fetchTeamNewsPool: no team name for team ${teamId} (${league.id})`);
  }

  return poolCache.get(
    poolCacheKey(league, teamId),
    () =>
      withHardCap(
        teamId,
        teamShortName,
        league,
        fetchTeamNewsPoolUncached(teamId, teamShortName, league),
      ),
    { force: options?.force },
  );
}
