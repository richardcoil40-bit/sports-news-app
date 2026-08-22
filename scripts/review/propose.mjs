#!/usr/bin/env node
/**
 * Builds the review worksheet for a league.
 *
 *   node scripts/review/propose.mjs <leagueId> [--no-probe] [--pace <s>]
 *
 * Writes docs/review/<leagueId>.review.md — one block per team, for a
 * person to rule on — and refreshes that league's roster in
 * src/lib/__data__/reviewed-teams.json, which is what team-review.test.ts
 * reads to know a league has been through here at all.
 *
 * ## What this does and does not claim
 *
 * Everything printed is either fetched, computed, or read out of the
 * tables. Nothing here decides anything: the candidates are *unverified*
 * suggestions, and the fields at the bottom of each block are empty
 * because a person has to fill them in. That is the whole design — the
 * gate exists because "nobody looked at this team" and "somebody looked
 * and there was nothing" had become the same state, and a script that
 * answered on your behalf would recreate exactly that.
 *
 * ## The three checks that do the real work
 *
 * 1. **Alias warning.** An alias is supposed to expand ESPN's abbreviation
 *    to the same school — `michigan-st` to `michigan-state`. One that
 *    *drops* a word points at a different school instead, which is how
 *    `washington-st` used to resolve to `washington`, quietly handing
 *    Washington State the Huskies and the Seattle Times.
 * 2. **Collision report.** Whether a nickname is safe is a question about
 *    the sources it will be matched against, never about the word — see
 *    nickname-safety.ts, which both this and the gate test call, so a
 *    worksheet can never approve something the test then rejects.
 * 3. **Owner-pattern probing.** Feeds are checked on scripts/check-feeds.sh's
 *    exact terms (probe.mjs), and a host belonging to a chain that has
 *    already been ruled dead is skipped without a request.
 *
 * Steps 1 and 2 cost nothing and rule out most candidates before step 3
 * opens a socket, which is the order to keep them in.
 *
 * ## Re-running is safe
 *
 * Answers already written into the worksheet are carried across verbatim —
 * see worksheet.mjs. Re-run it after adding a `probe:` host, or when a
 * league's roster changes.
 */
import fs from 'node:fs';
import path from 'node:path';

import { probeFeed } from './probe.mjs';
import { isProLeague, loadTables, readCatalog, readSnapshot, REVIEW_DIR, SNAPSHOT_PATH } from './tables.mjs';
import { ANSWER_FIELDS, field, parseWorksheet } from './worksheet.mjs';

function usage(message) {
  if (message) process.stderr.write(`propose.mjs: ${message}\n\n`);
  process.stderr.write(
    'Usage: node scripts/review/propose.mjs <leagueId> [--no-probe] [--pace <seconds>]\n' +
      '\n' +
      '  --no-probe        skip every network check of a feed URL\n' +
      '  --pace <seconds>  wait between probes (default 1, as check-feeds.sh does)\n',
  );
  process.exit(message ? 2 : 0);
}

function parseArgs(argv) {
  const options = { leagueId: null, probe: true, pace: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') usage();
    else if (arg === '--no-probe') options.probe = false;
    else if (arg === '--pace') options.pace = Number(argv[(i += 1)]);
    else if (arg.startsWith('-')) usage(`unknown option: ${arg}`);
    else if (options.leagueId) usage('give exactly one league id');
    else options.leagueId = arg;
  }
  if (!options.leagueId) usage('which league?');
  if (!Number.isFinite(options.pace) || options.pace < 0) usage('--pace wants a number of seconds');
  return options;
}

/**
 * ESPN's standings endpoint, and both shapes it answers with — the same
 * two teams.ts handles, for the same reason: a league with no conference
 * filter nests each division under `children` instead.
 */
async function fetchTeams(league, espnSitePath) {
  const base = `https://site.api.espn.com/apis/v2/sports/${espnSitePath(league)}/standings`;
  const url = league.espnGroup === undefined ? base : `${base}?group=${league.espnGroup}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  const json = await response.json();

  const entries = json?.standings?.entries?.length
    ? json.standings.entries
    : (json?.children ?? []).flatMap((child) => child?.standings?.entries ?? []);

  const seen = new Set();
  const teams = [];
  for (const entry of entries) {
    const team = entry?.team;
    if (!team?.id || seen.has(team.id)) continue;
    seen.add(team.id);
    teams.push({
      id: team.id,
      shortName: team.shortDisplayName,
      displayName: team.displayName,
      location: team.location ?? team.shortDisplayName,
      mascot: team.name ?? '',
    });
  }
  if (teams.length === 0) throw new Error(`${url} returned no teams`);
  return teams.sort((a, b) => a.shortName.localeCompare(b.shortName));
}

/** "Cornhuskers" → "Cornhusker". Nothing for a name that isn't a plural. */
function singular(name) {
  return /[^s]s$/.test(name) ? name.slice(0, -1) : null;
}

/**
 * What ESPN can suggest, which is less than the table holds.
 *
 * ESPN gives the formal mascot. A paper writes "Huskers", "Illini" and
 * "Terps", none of which are derivable from "Cornhuskers", "Fighting
 * Illini" or "Terrapins" — so these are a starting point for the person
 * doing the research, never the research. Marked unverified for that
 * reason.
 *
 * The bare last word of a multi-word mascot is proposed too, in both
 * numbers, even though the table's rule usually excludes it. Two reasons.
 * Seeing "Lions" come back reserved to Detroit is worth more than not
 * seeing it at all — the reviewer learns why the short form is out rather
 * than having to remember the rule. And the short forms are sometimes the
 * right answer: "Gopher" and "Husky" are both in the table, and neither is
 * reachable from "Golden Gophers" or "Huskies" any other way.
 */
function nicknameCandidates(team) {
  const tail = team.displayName?.startsWith(`${team.location} `)
    ? team.displayName.slice(team.location.length + 1)
    : null;

  const candidates = [];
  for (const base of [team.mascot, tail]) {
    if (!base) continue;
    const words = base.split(/\s+/);
    const last = words.length > 1 ? words.at(-1) : null;
    for (const form of [base, singular(base), last, last && singular(last)]) {
      if (form && !candidates.includes(form)) candidates.push(form);
    }
  }
  return candidates;
}

/** Which chain a URL belongs to, asked of the builders the table uses. */
function ownerOf(url, ownerFeedUrl) {
  let host;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  for (const [owner, build] of Object.entries(ownerFeedUrl)) {
    if (build(host) === url) return owner;
  }
  return null;
}

/**
 * The hosts to check for a team: the ones already in the table, plus
 * anything written on the worksheet's `probe:` line.
 *
 * A `probe:` entry is `host` or `host=owner`. Naming the owner is what
 * lets a dead chain be skipped without a request — and what stops Gannett
 * being re-verified once per team it owns, which is the whole point of
 * DEAD_FEED_OWNERS carrying the finding in the first place.
 */
function probeTargets(current, answers, { OWNER_FEED_URL, DEAD_FEED_OWNERS }) {
  const targets = current.map((source) => ({
    label: source.name,
    url: source.url,
    owner: ownerOf(source.url, OWNER_FEED_URL),
    inApp: true,
    dead: null,
  }));

  for (const line of (answers.probe ?? '').split(/[\n,]/)) {
    const entry = line.trim();
    if (!entry) continue;
    const [host, owner = null] = entry.split('=').map((part) => part.trim());
    if (!host) continue;
    const build = owner ? OWNER_FEED_URL[owner] : null;
    targets.push({
      label: host,
      url: build ? build(host) : `https://${host.replace(/^https?:\/\//, '')}`,
      owner,
      inApp: false,
      dead: owner ? (DEAD_FEED_OWNERS[owner] ?? null) : null,
      unknownOwner: Boolean(owner) && !build && !DEAD_FEED_OWNERS[owner],
    });
  }

  return targets;
}

function renderCollisions(hazards) {
  if (hazards.length === 0) return 'none';
  return hazards.map((hazard) => `${hazard.kind.toUpperCase()} — ${hazard.detail}`).join('; ');
}

function renderBlock(entry) {
  const { team, slug, current, hazards, candidates, probes, review, answers, reachable } = entry;

  const lines = [
    `## ${slug} — ${team.shortName}`,
    '```',
    field('espn_id', team.id),
    field('espn_short', team.shortName),
    field('espn_display', team.displayName),
    field('espn_location', team.location),
    field('espn_mascot', team.mascot || '(none)'),
    field('slug', slug),
    field('alias_warning', entry.alias),
    field(
      'nicknames_reach',
      reachable
        ? `${current.filter((s) => s.scope === 'broad').length} broad source(s) — nicknames are matched against these`
        : 'NOTHING — no broad-scoped source, so nicknames never run for this team',
    ),
    '',
    field(
      'current_nicknames',
      !review.nickname.reviewed
        ? 'NOT REVIEWED — nobody has ruled on this team'
        : [
            (entry.nicknames.length > 0 ? entry.nicknames.join(', ') : '(reviewed, deliberately none)') +
              '   [reviewed]',
            ...(review.nickname.reason ? [`reason: ${review.nickname.reason}`] : []),
            ...hazards.map((hazard) => `${hazard.kind.toUpperCase()} — ${hazard.detail}`),
          ],
    ),
    field(
      'current_sources',
      review.sources === null
        ? 'no curated table for this league — ESPN and the national pool only'
        : review.sources.reviewed
          ? [
              ...(current.length > 0
                ? current.map((s) => `${s.name.padEnd(26)}tier ${s.tier}  ${s.scope}`)
                : ['(reviewed, deliberately none)']),
              ...(review.sources.reason ? [`reason: ${review.sources.reason}`] : []),
            ]
          : 'NOT REVIEWED — nobody has ruled on this team',
    ),
    '',
    field(
      'nickname_candidates',
      candidates.length > 0
        ? candidates.map(
            (candidate) =>
              `${candidate.name.padEnd(22)} ${(candidate.inTable ? 'in table' : 'new').padEnd(9)} ` +
              `collisions: ${renderCollisions(candidate.hazards)}`,
          )
        : '(ESPN gave no mascot to suggest from)',
    ),
    field(
      'source_candidates',
      probes.length > 0
        ? probes.map(
            (probe) =>
              `${probe.label.padEnd(24)} ${(probe.owner ?? '—').padEnd(9)} ` +
              `${probe.inApp ? 'in app   ' : 'candidate'} ${probe.result}`,
          )
        : '(nothing to check — add hosts to probe: below and re-run)',
    ),
    '',
    // A one-line answer stays on its line and a longer one indents under
    // the key. Both read back the same way, so this is only about the file
    // being pleasant to sit with.
    ...ANSWER_FIELDS.map((name) =>
      field(name, answers[name]?.includes('\n') ? answers[name].split('\n') : (answers[name] ?? '')),
    ),
    '```',
    '',
  ];
  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tables = await loadTables();

  const league = readCatalog().find((entry) => entry?.id === options.leagueId);
  if (!league) usage(`no league "${options.leagueId}" in src/lib/__data__/leagues.json`);

  const teams = await fetchTeams(league, tables.leagues.espnSitePath);
  const curated = tables.sources.CURATED_SOURCE_TABLES[league.id] ?? null;

  const snapshot = readSnapshot();
  const reserved = tables.safety.reservedNames(snapshot.leagues ?? {});
  const world = tables.safety.curatedTeams();
  const worldBySlug = new Map(world.map((entry) => [entry.slug, entry]));
  const baseline = tables.safety.nicknameHazards(world, reserved);

  const worksheetPath = path.join(REVIEW_DIR, `${league.id}.review.md`);
  const existing = fs.existsSync(worksheetPath) ? fs.readFileSync(worksheetPath, 'utf8') : '';
  const answersBySlug = parseWorksheet(existing);

  const blocks = [];
  let probeCount = 0;

  for (const team of teams) {
    const slug = tables.slug.teamSlug(team.shortName);
    const answers = answersBySlug.get(slug) ?? {};
    const current = curated ? [...(curated.sourcesBySlug[slug] ?? [])] : [];
    const nicknames = tables.nicknames.teamNicknamesFor(team.shortName);
    const known = worldBySlug.get(slug) ?? { slug, name: team.shortName, nicknames, broadSourceIds: [] };

    // A candidate is judged by adding it to this team's claims and asking
    // the same function the gate asks — never by a second opinion about
    // the same word.
    const candidates = nicknameCandidates(team).map((name) => {
      const inTable = nicknames.some((entry) => entry.toLowerCase() === name.toLowerCase());
      // Adding a word the team already claims would have it collide with
      // itself, so a candidate already in the table is judged as it stands.
      const claims = inTable ? known.nicknames : [...known.nicknames, name];
      const hypothetical = worldBySlug.has(slug)
        ? world.map((entry) => (entry.slug === slug ? { ...entry, nicknames: claims } : entry))
        : [...world, { ...known, nicknames: claims }];
      const found = tables.safety.nicknameHazards(hypothetical, reserved);
      return {
        name,
        inTable,
        hazards: found.filter(
          (hazard) => hazard.slug === slug && hazard.nickname.toLowerCase() === name.toLowerCase(),
        ),
      };
    });

    const targets = probeTargets(current, answers, tables.sources).map((target) =>
      options.probe ? target : { ...target, skip: 'not probed' },
    );

    const probes = [];
    for (const target of targets) {
      if (target.dead) probes.push({ ...target, result: `SKIP — owner recorded dead: ${target.dead}` });
      else if (target.unknownOwner) probes.push({ ...target, result: 'SKIP — unknown owner, see OWNER_FEED_URL' });
      else if (target.skip) probes.push({ ...target, result: target.skip });
      else {
        const outcome = await probeFeed(target.url, { paceSeconds: options.pace });
        probeCount += 1;
        probes.push({
          ...target,
          result:
            outcome.status === 'OK'
              ? `OK  ${outcome.format}  ${outcome.items} items`
              : `${outcome.status}${outcome.detail ? ` — ${outcome.detail}` : ''}`,
        });
      }
    }

    blocks.push({
      team,
      slug,
      // The judgment lives in team-slug.ts, where the gate test also reads
      // it — a warning the worksheet raised and the test didn't would be
      // two opinions about one table.
      alias:
        tables.slug.aliasWarningFor(team.shortName) ??
        (tables.slug.rawTeamSlug(team.shortName) === slug ? 'none' : `aliased to "${slug}"`),
      current,
      nicknames,
      reachable: tables.safety.nicknamesAreReachable(known),
      hazards: baseline.filter((hazard) => hazard.slug === slug),
      candidates,
      probes,
      review: {
        nickname: tables.nicknames.nicknameReviewFor(team.shortName),
        sources: curated ? curated.reviewFor(team.shortName) : null,
      },
      answers,
    });
  }

  const unreviewed = blocks.filter(
    (block) => !block.review.nickname.reviewed || (block.review.sources && !block.review.sources.reviewed),
  );
  const defects = baseline.filter((hazard) => hazard.kind !== 'contested');

  fs.mkdirSync(REVIEW_DIR, { recursive: true });
  fs.writeFileSync(
    worksheetPath,
    [
      `# ${league.displayName} — team review worksheet`,
      '',
      `Generated by \`node scripts/review/propose.mjs ${league.id}\` on ${new Date().toISOString().slice(0, 10)}.`,
      'Everything above the answer fields is regenerated on every run; your answers are not.',
      '',
      `- **${teams.length} teams**, ${unreviewed.length} of them not yet ruled on.`,
      `- **${defects.length} defects** in what is already shipped (a shared source, or a reserved word).`,
      `- ${probeCount} feed${probeCount === 1 ? '' : 's'} probed.`,
      '',
      'Fill in `decision:` (`approve` / `reject` / `edit`) and the fields under it for every',
      'block, then run `node scripts/review/apply.mjs ' + league.id + '`. An empty `decision:`',
      'is what stops a league shipping unreviewed, so leave one blank rather than guessing.',
      '',
      'Nickname candidates come from ESPN and are **unverified** — ESPN gives "Cornhuskers"',
      'and the Lincoln Journal Star writes "Huskers". Finding the second is the research;',
      'the collision column is there to tell you what a candidate would cost.',
      '',
      '---',
      '',
      ...blocks.map(renderBlock),
    ].join('\n'),
  );

  snapshot.leagues = snapshot.leagues ?? {};
  snapshot.leagues[league.id] = {
    displayName: league.displayName,
    pro: isProLeague(league),
    generated: new Date().toISOString().slice(0, 10),
    teams: blocks.map((block) => ({
      id: block.team.id,
      slug: block.slug,
      shortName: block.team.shortName,
      displayName: block.team.displayName,
      mascot: block.team.mascot,
    })),
  };
  const ordered = Object.fromEntries(Object.entries(snapshot.leagues).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify({ leagues: ordered }, null, 2)}\n`);

  process.stdout.write(
    `${league.displayName}: ${teams.length} teams, ${unreviewed.length} unreviewed, ` +
      `${defects.length} defects, ${probeCount} probed\n` +
      `Wrote ${path.relative(process.cwd(), worksheetPath)}\n` +
      `Wrote ${path.relative(process.cwd(), SNAPSHOT_PATH)}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`propose.mjs: ${error.message}\n`);
  process.exit(1);
});
