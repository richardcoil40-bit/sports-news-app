#!/usr/bin/env node
/**
 * How much of what a team's sources publish actually reaches that team's feed.
 *
 *   node scripts/review/yield.mjs [leagueId ...] [--min <n>] [--json]
 *
 * ## The gap this fills
 *
 * scripts/check-feeds.sh asks whether a URL still returns items, and
 * docs/evidence/ records the answer. That question has a blind spot: a
 * source can answer with fifty healthy items and still contribute nothing,
 * because every filter between the feed and the screen runs *after*
 * liveness. Cincinnati was the case that made it visible — The News Record
 * returns a full sports feed, and one article survived to the team screen.
 * Nothing was broken in the sense check-feeds.sh can see.
 *
 * So this asks the next question instead: of what a source publishes, how
 * much names the team, and how much of *that* is the league's own sport.
 * A source at 0% is as dead as a 404 from where the reader sits, and this
 * is the only report that says so.
 *
 * ## It runs the pipeline, it does not model it
 *
 * Every filter here is imported from src/lib/ and called on real Article
 * objects parsed by the app's own fetchFeeds — same XMLValidator gate, same
 * name matching, same lexicons. A second implementation would drift, and a
 * yield report that disagreed with the app would be worse than none: it
 * would send someone to fix a source that was fine.
 *
 * The one thing deliberately left out is the verdict service. It is off by
 * default in the app (EXPO_PUBLIC_VERDICT_URL unset) and costs money when
 * it isn't, so the numbers here are the local filters alone — the floor the
 * app shows with no service configured, which is what ships today.
 *
 * ## Reading the output
 *
 * Per source: `items → named → kept`. The two drops answer different
 * questions and want different fixes.
 *
 * - **items → named** is the team-name filter. A big drop on a *broad*
 *   source means the paper writes about the team by a name the tables
 *   don't have — an abbreviation ("UC"), a nickname, a shortening. The fix
 *   is team-nicknames.ts, and nickname-safety.ts decides whether the word
 *   is safe to add. A big drop is not automatically wrong: a metro daily
 *   covering four pro teams *should* shed most of its feed.
 * - **named → kept** is off-topic.ts and off-sport.ts. A big drop here
 *   usually means the source is a whole athletic department in the
 *   offseason, which is working as intended and not a defect.
 *
 * `team`-scoped sources skip the name filter entirely (team-news-pool.ts
 * takes them wholesale), so their first number is always a no-op.
 */
import { loadAppModule } from '../lib/app-modules.mjs';
import { isProLeague, loadTables, readCatalog, readSnapshot } from './tables.mjs';

function usage(message) {
  if (message) process.stderr.write(`yield.mjs: ${message}\n\n`);
  process.stderr.write(
    'Usage: node scripts/review/yield.mjs [leagueId ...] [--min <n>] [--json]\n' +
      '\n' +
      '  leagueId    one or more league ids; default is every league with a\n' +
      '              curated source table\n' +
      '  --min <n>   flag a team whose feed ends below n articles (default 3)\n' +
      '  --json      emit the raw per-source numbers instead of the report\n',
  );
  process.exit(message ? 2 : 0);
}

function parseArgs(argv) {
  const options = { leagueIds: [], min: 3, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') usage();
    else if (arg === '--json') options.json = true;
    else if (arg === '--min') options.min = Number(argv[(i += 1)]);
    else if (arg.startsWith('-')) usage(`unknown option: ${arg}`);
    else options.leagueIds.push(arg);
  }
  if (!Number.isFinite(options.min) || options.min < 0) usage('--min wants a number');
  return options;
}

/**
 * Every source in a league, fetched once and shared.
 *
 * Sources are not unique per team — AL.com serves Alabama and Auburn, the
 * LA Times serves UCLA and USC — and the national pool serves all of them.
 * Fetching per team would re-request the same feed a dozen times, which is
 * both slow and rude to a paper that already rate-limits.
 */
async function fetchAllSources(sources, fetchFeeds) {
  const byUrl = new Map();
  for (const source of sources) {
    if (!byUrl.has(source.url)) byUrl.set(source.url, source);
  }

  const { articles, failedSources } = await fetchFeeds([...byUrl.values()]);

  // fetchFeeds returns one flat list, so articles are grouped back by the
  // source name it stamped on each. Failed sources get an empty list
  // rather than being absent, so a dead feed reads as "0 items" in the
  // report instead of vanishing from it.
  const bySource = new Map([...byUrl.values()].map((s) => [s.name, []]));
  for (const article of articles) {
    const list = bySource.get(article.source);
    if (list) list.push(article);
  }
  return { bySource, failed: new Set(failedSources) };
}

function dedupe(articles) {
  const seen = new Set();
  return articles.filter((a) => {
    if (seen.has(a.link)) return false;
    seen.add(a.link);
    return true;
  });
}

/**
 * One team's numbers, source by source.
 *
 * Mirrors fetchTeamNewsPoolUncached's stages in the same order: broad
 * sources are narrowed to the names that source is entitled to match on,
 * team sources are taken whole, and off-topic/off-sport run last over the
 * deduped result. The per-source `kept` figure runs those last two per
 * source rather than on the union, which is the only way to attribute a
 * drop to the source that caused it.
 */
function measureTeam({ team, sources, league, fetched, lib }) {
  const { filterArticlesForTeams, filterOffTopic, filterOtherSports, localNamesFor, schoolNamesFor } = lib;

  const rows = [];
  const contributed = [];

  for (const source of sources) {
    const items = fetched.bySource.get(source.name) ?? [];
    // The same split team-news-pool.ts makes: the local paper is matched
    // on nicknames as well as the school name, the national pool and
    // ESPN's own feed on the school name alone. A team-scoped source is
    // matched on nothing at all.
    const named =
      source.scope === 'broad'
        ? filterArticlesForTeams(
            items,
            source.reach === 'national' ? schoolNamesFor(team.shortName) : localNamesFor(team.shortName),
          )
        : items;
    const kept = filterOtherSports(filterOffTopic(named), league);

    rows.push({
      source: source.name,
      id: source.id,
      scope: source.scope,
      reach: source.reach ?? 'beat',
      failed: fetched.failed.has(source.name),
      items: items.length,
      named: named.length,
      kept: kept.length,
    });
    contributed.push(...kept);
  }

  return { rows, total: dedupe(contributed).length };
}

/**
 * Why a source contributed nothing, in the terms the fix is written in.
 *
 * Only the unambiguous cases get a label. "Every item was another sport"
 * is a finding; "some of it was" is the offseason, and guessing between
 * them is how a report starts sending people to fix things that are fine.
 */
function diagnose(row) {
  if (row.failed) return 'source failed — check-feeds.sh territory, not this report';
  if (row.items === 0) return 'answered with no items';
  if (row.named === 0) return 'nothing named the team — a naming gap, see team-nicknames.ts';
  if (row.kept === 0) {
    // A team-scoped source skips the name filter (its `named` is a no-op —
    // see measureTeam), so "named the team" would imply a check that never
    // ran. That wording is how a dead team blog got misread as a filtering
    // problem once; say what actually happened for each scope.
    return row.scope === 'broad'
      ? 'everything that named the team was another sport or off-topic'
      : 'everything it published was another sport or off-topic';
  }
  return null;
}

function bar(value, total) {
  if (total === 0) return '';
  return `${Math.round((value / total) * 100)}%`;
}

function report(results, min) {
  const lines = [];

  for (const league of results) {
    lines.push('', `## ${league.displayName}`, '');
    for (const team of league.teams) {
      const flag = team.total < min ? '  ⚠' : '';
      lines.push(`${team.shortName} — ${team.total} article${team.total === 1 ? '' : 's'}${flag}`);
      if (team.rows.length === 0) {
        lines.push('    (no curated sources — national pool only)');
      }
      for (const row of team.rows) {
        const scope = row.scope === 'broad' ? `broad/${row.reach}` : 'team';
        lines.push(
          `    ${row.source.padEnd(28)} ${scope.padEnd(15)} ` +
            `${String(row.items).padStart(3)} → ${String(row.named).padStart(3)} → ${String(row.kept).padStart(3)}` +
            `  ${bar(row.kept, row.items).padStart(4)}`,
        );
        const why = diagnose(row);
        if (why) lines.push(`        ${why}`);
      }
      lines.push('');
    }
  }

  const flagged = results.flatMap((l) =>
    l.teams.filter((t) => t.total < min).map((t) => `${l.displayName} / ${t.shortName} (${t.total})`),
  );

  lines.push('', '## Below the floor', '');
  if (flagged.length === 0) {
    lines.push(`Every team ends at ${min} or more.`);
  } else {
    for (const entry of flagged) lines.push(`  ⚠ ${entry}`);
  }

  // The naming gaps are the actionable half and are easy to lose in the
  // per-team listing, so they get repeated here on their own.
  const gaps = results.flatMap((l) =>
    l.teams.flatMap((t) =>
      t.rows
        .filter((r) => !r.failed && r.items > 0 && r.named === 0 && r.scope === 'broad')
        .map((r) => `${l.displayName} / ${t.shortName}: ${r.source} — ${r.items} items, none named the team`),
    ),
  );
  lines.push('', '## Naming gaps', '');
  if (gaps.length === 0) lines.push('None — every live broad source named its team at least once.');
  else for (const gap of gaps) lines.push(`  ${gap}`);

  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const [{ fetchFeeds }, conference, offSport, offTopic, tables] = await Promise.all([
    loadAppModule('@/lib/feeds'),
    loadAppModule('@/lib/conference-filter'),
    loadAppModule('@/lib/off-sport'),
    loadAppModule('@/lib/off-topic'),
    loadTables(),
  ]);
  const sourceCatalog = await loadAppModule('@/lib/community-sources');

  const lib = {
    filterArticlesForTeams: conference.filterArticlesForTeams,
    filterOffTopic: offTopic.filterOffTopic,
    filterOtherSports: offSport.filterOtherSports,
    localNamesFor: tables.nicknames.localNamesFor,
    schoolNamesFor: tables.nicknames.schoolNamesFor,
  };

  const catalog = readCatalog();
  const snapshot = readSnapshot();
  const wanted =
    options.leagueIds.length > 0
      ? options.leagueIds
      : Object.keys(sourceCatalog.CURATED_SOURCE_TABLES);

  const results = [];

  for (const leagueId of wanted) {
    const league = catalog.find((l) => l.id === leagueId);
    if (!league) usage(`no such league in the bundled catalog: ${leagueId}`);
    const teams = snapshot.leagues?.[leagueId]?.teams;
    if (!teams) usage(`no roster snapshot for ${leagueId} — run propose.mjs first`);

    // Pro leagues have no curated per-team table; their teams run on the
    // national pool alone, which is a normal state (see source-catalog.ts).
    const table = sourceCatalog.CURATED_SOURCE_TABLES[leagueId];
    if (!table && !isProLeague(league)) {
      usage(`${leagueId} has no curated source table`);
    }

    const perTeam = teams.map((team) => ({
      team,
      sources: table ? [...(table.sourcesBySlug[tables.slug.teamSlug(team.shortName)] ?? [])] : [],
    }));

    const fetched = await fetchAllSources(perTeam.flatMap((t) => t.sources), fetchFeeds);

    results.push({
      id: leagueId,
      displayName: league.displayName,
      teams: perTeam.map(({ team, sources }) => ({
        shortName: team.shortName,
        slug: team.slug,
        ...measureTeam({ team, sources, league, fetched, lib }),
      })),
    });
  }

  process.stdout.write(options.json ? `${JSON.stringify(results, null, 2)}\n` : `${report(results, options.min)}\n`);
}

main().catch((error) => {
  process.stderr.write(`yield.mjs: ${error.message}\n`);
  process.exit(1);
});
